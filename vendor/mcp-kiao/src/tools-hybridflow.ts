import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { guard, ok } from './tools-common.js';
import type { HybridflowApi } from './hybridflow/api.js';

// Keep design guidance and shared behavior in the hybridflow skill. Tool descriptions
// carry invocation details, write hazards and targeted reference paths; repeated schemas
// should not bring the domain manual into every tool discovery response.
const HANDLE = z.string().describe('Board slug or id from board_list/board_create.');
const CARD_ID = z.string().describe('Card id from board_get.');
const CLASS_ID = z.string().describe('Node class id from board_get/class_list.');
const VERSION_ID = z.string().describe('Version id from class_get.');
const WORKFLOW_ID = z.string().describe('Workflow id from board_get.');
const AGENT_ID = z.string().describe('Managed agent id from agent_list.');

const TYPE = z.enum(['human', 'ai', 'shutdown', 'scheduler', 'gateway', 'note', 'value'])
    .describe('Card type. See hybridflow references/cards.md.');
const CLASS_TYPE = z.enum(['human', 'ai', 'shutdown', 'scheduler']);
const NOTE = z.string().describe('Note card Markdown.');
const VALUE = z.unknown().describe('Value card JSON payload.');
const VALUE_TYPE = z.string().describe('Value type: empty, "json-schema", or a same-board schema value id.');
const OUTPUT_TYPE = z.string().describe('Task schema id from board_schema_values; empty removes the schema. See hybridflow references/structured-data.md.');
const TAGS = z.array(z.string()).describe('Tag words; whole replacement.');
const BODY = z.string().describe('Task description.');
const CRITERIA = z.array(z.object({
    id: z.string().optional().describe('Criterion id; minted if omitted.'),
    text: z.string().describe('Success criterion.'),
}).strict()).describe('Success criteria; whole replacement.');
const COMPLEXITY = z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(5),
    z.literal(8), z.literal(13), z.literal(21),
]).describe('Optional work estimate.');
const SETTINGS = z.object({
    agent: z.string().optional().describe('Managed agent id from agent_list.'),
    effort: z.string().optional().describe('Effort supported by the selected harness.'),
    permission: z.string().optional().describe('Permission mode supported by the selected harness.'),
    folder: z.string().optional().describe('Store-root folder link, starting with /.'),
    runner: z.string().optional().describe('Optional runner id from runner_list.'),
    extra: z.record(z.string()).optional().describe('Preserved extension settings.'),
}).strict().describe('Execution settings; whole replacement, including runner and extra.');
const AT = z.string().describe('Scheduler local YYYY-MM-DDTHH:mm; alternative to duration. Empty clears.');
const DURATION = z.string().describe('Scheduler positive h/m/s/ms wait, e.g. 15m; alternative to at. Empty clears.');
const SPOT = z.object({
    x: z.number().int().min(0).describe('Canvas x in pixels.'),
    y: z.number().int().min(0).describe('Canvas y in pixels.'),
}).strict().describe('Position; omit for editor placement.');
const STATUS = z.enum(['draft', 'ready', 'todo', 'blocked', 'running', 'waiting-refresh', 'interrupted', 'done', 'error'])
    .describe('Work state; ready offers Play. Never manufacture running or waiting-refresh.');
const ON_SUCCESS = z.object({
    flowNode: z.string().optional().describe('Single successor card id; empty unlinks.'),
    flowNodes: z.array(z.string()).optional().describe('Gateway successor ids.'),
    mode: z.enum(['end', 'continue']).optional().describe('AI conversation handover; default end.'),
    compact: z.boolean().optional().describe('Compact the AI conversation after success.'),
}).strict().describe('Whole replacement; preserve other options. See hybridflow references/chains.md.');
const IF_MATCH = z.number().int().optional().describe('Revision from the read; send for derived writes. On 409, read again.');
const CLASS_ON_SUCCESS = z.object({
    flowNode: z.string().optional().describe('Successor class id, never a version or card id.'),
    mode: z.enum(['end', 'continue']).optional().describe('AI instance conversation handover.'),
    compact: z.boolean().optional().describe('Compact the AI instance conversation after success.'),
}).strict().describe('Class successor and conversation options; whole replacement.');
const BODIES = z.record(z.string()).optional().describe('Filled template bodies by class id.');

// Shared writable fields keep creation and partial patches in sync. Read-only runtime
// fields stay outside this strict shape; creation separately requires an explicit type.
const CARD_FIELDS = {
    title: z.string().optional().describe('Card name; AI prompt fallback if body is empty.'),
    type: TYPE.optional(),
    tags: TAGS.optional(),
    note: NOTE.optional(),
    value: VALUE.optional(),
    valueType: VALUE_TYPE.optional(),
    outputType: OUTPUT_TYPE.optional(),
    body: BODY.optional(),
    criteria: CRITERIA.optional(),
    complexity: COMPLEXITY.optional(),
    settings: SETTINGS.optional(),
    at: AT.optional(),
    duration: DURATION.optional(),
    spot: SPOT.optional(),
    status: STATUS.optional(),
    archived: z.boolean().optional().describe('Hide or restore the card.'),
    onSuccess: ON_SUCCESS.optional(),
    workflow: z.string().optional().describe('Workflow group id on this board; empty ungroups.'),
};

/** Register the hybridflow tools on an MCP server. */
export function registerHybridflowTools(server: McpServer, hybridflow: HybridflowApi): void {
    server.registerTool('board_schema_values', {
        description: 'List JSON Schema values on non-archived boards and cards, including ids, schemas and board names.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.listSchemaValues())));

    // ── Boards ──────────────────────────────────────────────────────────────
    server.registerTool('board_list', {
        description: 'List board names and handles; use the returned handle for board operations.',
        inputSchema: {
            archived: z.boolean().optional().describe('Include archived boards; default false.'),
        },
    }, guard(async ({ archived }) => ok(await hybridflow.listBoards(archived ?? false))));

    server.registerTool('board_create', {
        description: 'Create a board and return its full snapshot with the new handle. Name must be free.',
        inputSchema: {
            name: z.string().describe('Unique board name.'),
        },
    }, guard(async ({ name }) => ok(await hybridflow.createBoard(name))));

    server.registerTool('board_get', {
        description: 'Read a full board snapshot with cards, classes, workflows, revisions and cursor. Start edits here. The hybridflow skill provides design guidance and reference routing.',
        inputSchema: { handle: HANDLE },
    }, guard(async ({ handle }) => ok(await hybridflow.getBoard(handle))));

    server.registerTool('board_patch', {
        description: 'Rename, archive or restore a board; its handle stays stable.',
        inputSchema: {
            handle: HANDLE,
            name: z.string().optional().describe('New unique name.'),
            archive: z.boolean().optional().describe('Archive or restore the board.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, name, archive, ifMatch }) =>
        ok(await hybridflow.patchBoard(handle, { name, archive }, ifMatch))));

    server.registerTool('board_delete', {
        description: 'Permanently delete the board and all its cards, classes, versions and workflow groups.',
        inputSchema: { handle: HANDLE },
    }, guard(async ({ handle }) => ok(await hybridflow.deleteBoard(handle))));

    // ── Cards ───────────────────────────────────────────────────────────────
    server.registerTool('board_add_cards', {
        description: 'Create cards in order and return their ids. Read hybridflow references/cards.md for fields and references/structured-data.md for handoffs.',
        inputSchema: {
            handle: HANDLE,
            flowNodes: z.array(z.object({
                id: z.string().optional().describe('Omit for a minted id; supply collision-free ids for batch links.'),
                ...CARD_FIELDS,
                type: TYPE,
            }).strict()).describe('Cards to create; links may reference ids in the same batch.'),
        },
    }, guard(async ({ handle, flowNodes }) => ok(await hybridflow.createFlowNodes(handle, flowNodes))));

    server.registerTool('board_get_card', {
        description: 'Read one card, including its revision, stored output and current run claim.',
        inputSchema: { handle: HANDLE, id: CARD_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getFlowNode(handle, id))));

    server.registerTool('board_patch_card', {
        description: 'Patch named card fields. Nested objects and arrays are replaced whole; preserve their other entries. Read first and send ifMatch. Unknown and read-only fields are refused.',
        inputSchema: {
            handle: HANDLE,
            id: CARD_ID,
            patch: z.object({
                ...CARD_FIELDS,
                clearComplexity: z.boolean().optional().describe('Clear the estimate.'),
                clearSpot: z.boolean().optional().describe('Clear the position.'),
                classVersion: z.string().optional().describe('Bind to a class version id; empty detaches.'),
            }).strict().describe('Fields to change; omit unchanged fields.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, patch, ifMatch }) => ok(await hybridflow.patchFlowNode(handle, id, patch, ifMatch))));

    server.registerTool('board_delete_cards', {
        description: 'Permanently delete cards and remove incoming links. Deleted schema ids remain on task output references; repair affected tasks before Play.',
        inputSchema: {
            handle: HANDLE,
            flowNodes: z.array(z.string()).describe('The card ids to remove.'),
        },
    }, guard(async ({ handle, flowNodes }) => ok(await hybridflow.deleteFlowNodes(handle, flowNodes))));

    server.registerTool('board_chain_card', {
        description: 'Link or unlink cards without changing conversation options. Empty clears outgoing links; on a Gateway, a target adds a branch. Topology rules: hybridflow references/chains.md.',
        inputSchema: {
            handle: HANDLE,
            id: CARD_ID,
            flowNode: z.string().describe('Successor card id; empty unlinks.'),
        },
    }, guard(async ({ handle, id, flowNode }) => ok(await hybridflow.chainFlowNode(handle, id, flowNode))));

    server.registerTool('board_card_usage', {
        description: 'Read accumulated card usage reports, token counts and known costs.',
        inputSchema: { handle: HANDLE, id: CARD_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getFlowNodeUsage(handle, id))));

    server.registerTool('board_card_to_class', {
        description: 'Create a reusable node class and first version from an AI or Human task.',
        inputSchema: { handle: HANDLE, id: CARD_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.convertFlowNodeToClass(handle, id))));

    // ── Workflows ───────────────────────────────────────────────────────────
    server.registerTool('workflow_create', {
        description: 'Create a workflow group and assign cards. Already-grouped cards move into it.',
        inputSchema: {
            handle: HANDLE,
            name: z.string().optional().describe('Workflow group name.'),
            flowNodes: z.array(z.string()).optional().describe('Member card ids on this board.'),
        },
    }, guard(async ({ handle, name, flowNodes }) => ok(await hybridflow.createWorkflow(handle, { name, flowNodes }))));

    server.registerTool('workflow_get', {
        description: 'Read one workflow group.',
        inputSchema: { handle: HANDLE, id: WORKFLOW_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getWorkflow(handle, id))));

    server.registerTool('workflow_patch', {
        description: 'Rename a workflow group without changing membership.',
        inputSchema: {
            handle: HANDLE,
            id: WORKFLOW_ID,
            name: z.string().describe('New name.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, name, ifMatch }) => ok(await hybridflow.patchWorkflow(handle, id, { name }, ifMatch))));

    server.registerTool('workflow_delete', {
        description: 'Delete workflow groups and retain their ungrouped cards.',
        inputSchema: {
            handle: HANDLE,
            workflows: z.array(z.string()).describe('The workflow ids to remove.'),
        },
    }, guard(async ({ handle, workflows }) => ok(await hybridflow.deleteWorkflows(handle, workflows))));

    // ── Workflow classes ────────────────────────────────────────────────────
    server.registerTool('workflow_class_list', {
        description: 'List workflow classes across boards.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.listWorkflowClasses())));

    server.registerTool('workflow_class_create', {
        description: 'Create a workflow class and assign node classes to it.',
        inputSchema: {
            handle: HANDLE,
            name: z.string().optional().describe('Workflow class name.'),
            classes: z.array(z.string()).optional().describe('Member class ids on this board.'),
        },
    }, guard(async ({ handle, name, classes }) => ok(await hybridflow.createWorkflowClass(handle, { name, classes }))));

    server.registerTool('workflow_class_get', {
        description: 'Read one workflow class.',
        inputSchema: {
            handle: HANDLE,
            id: z.string().describe('Workflow class id from board_get.'),
        },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getWorkflowClass(handle, id))));

    server.registerTool('workflow_class_patch', {
        description: 'Rename a workflow class without changing membership.',
        inputSchema: {
            handle: HANDLE,
            id: z.string().describe('Workflow class id from board_get.'),
            name: z.string().describe('New name.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, name, ifMatch }) =>
        ok(await hybridflow.patchWorkflowClass(handle, id, { name }, ifMatch))));

    server.registerTool('workflow_class_delete', {
        description: 'Delete workflow classes and retain their ungrouped node classes.',
        inputSchema: {
            handle: HANDLE,
            workflowClasses: z.array(z.string()).describe('The workflow class ids to remove.'),
        },
    }, guard(async ({ handle, workflowClasses }) => ok(await hybridflow.deleteWorkflowClasses(handle, workflowClasses))));

    server.registerTool('workflow_class_instantiate', {
        description: 'Instantiate workflow class members on the destination board. Complete task settings and schemas afterward; see hybridflow references/reuse/workflows.md.',
        inputSchema: {
            handle: HANDLE,
            id: z.string().describe('Source workflow class id from workflow_class_list.'),
            spot: SPOT.optional(),
            bodies: BODIES,
            agents: z.record(z.string(), AGENT_ID).optional().describe("Explicit task agent IDs keyed by source class ID."),
        },
    }, guard(async ({ handle, id, spot, bodies, agents }) =>
        ok(await hybridflow.instantiateWorkflowClass(handle, id, { spot, bodies, agents }))));

    // ── Node classes ────────────────────────────────────────────────────────
    server.registerTool('class_list', {
        description: 'List node classes across boards; use class_get for versions.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.listFlowNodeClasses())));

    server.registerTool('class_create', {
        description: 'Create a node class and its first version. Shared fields, version fields and instance settings: hybridflow references/classes.md.',
        inputSchema: {
            handle: HANDLE,
            title: z.string().describe('Class title.'),
            instantiable: z.boolean().optional().describe('Offer in the Instantiate menu; default false.'),
            type: CLASS_TYPE.optional(),
            tags: TAGS.optional(),
            body: z.string().optional().describe('First version description.'),
            criteria: CRITERIA.optional(),
            template: z.boolean().optional().describe('First version is a fill-in template.'),
            at: AT.optional(),
            duration: DURATION.optional(),
            spot: SPOT.optional(),
            permission: z.string().optional().describe('AI instance permission mode.'),
            runner: z.string().optional().describe('AI instance runner id, or empty.'),
            note: z.string().optional().describe('Class guidance; not copied to instances.'),
            onSuccess: CLASS_ON_SUCCESS.optional(),
            published: z.boolean().optional().describe('Publish the first version immediately.'),
            workflowClass: z.string().optional().describe('Workflow class group id on this board.'),
        },
    }, guard(async ({ handle, ...rest }) => ok(await hybridflow.createFlowNodeClass(handle, rest))));

    server.registerTool('class_get', {
        description: 'Read a node class and its versions, oldest first, with independent revisions.',
        inputSchema: { handle: HANDLE, id: CLASS_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getFlowNodeClass(handle, id))));

    server.registerTool('class_patch', {
        description: 'Patch class fields. Edit draft wording with class_patch_version; published wording requires a new version.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            patch: z.object({
                title: z.string().optional().describe('New title.'),
                instantiable: z.boolean().optional().describe('Offer the class in the Instantiate menu.'),
                type: CLASS_TYPE.optional(),
                tags: z.array(z.string()).optional().describe('Tag words; whole replacement.'),
                at: z.string().optional().describe('New Scheduler datetime; nonempty clears duration.'),
                duration: DURATION.optional(),
                onSuccess: CLASS_ON_SUCCESS.optional(),
                permission: z.string().optional().describe('AI instance permission mode.'),
                runner: z.string().optional().describe('AI instance runner id.'),
                note: z.string().optional().describe('New note.'),
                spot: SPOT.optional(),
                clearSpot: z.boolean().optional().describe('Takes the class off the board.'),
                workflowClass: z.string().optional().describe('Workflow class group id; empty ungroups.'),
            }).strict().describe('The fields to change.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, patch, ifMatch }) => ok(await hybridflow.patchFlowNodeClass(handle, id, patch, ifMatch))));

    server.registerTool('class_delete', {
        description: 'Permanently delete node classes and their versions.',
        inputSchema: {
            handle: HANDLE,
            flowNodeClasses: z.array(z.string()).describe('The class ids to remove.'),
        },
    }, guard(async ({ handle, flowNodeClasses }) => ok(await hybridflow.deleteFlowNodeClasses(handle, flowNodeClasses))));

    server.registerTool('class_chain', {
        description: 'Link to a successor class id; an empty target unlinks. Never pass a version or card id.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            flowNode: z.string().describe('Successor class id; empty unlinks.'),
        },
    }, guard(async ({ handle, id, flowNode }) => ok(await hybridflow.chainFlowNodeClass(handle, id, flowNode))));

    server.registerTool('class_create_version', {
        description: 'Create a draft version, optionally copied from an existing version.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            body: z.string().optional().describe('The description.'),
            criteria: CRITERIA.optional(),
            template: z.boolean().optional().describe('Fill body during instantiation.'),
            from: z.string().optional().describe('Source version id; omit for a blank draft.'),
        },
    }, guard(async ({ handle, id, body, criteria, template, from }) =>
        ok(await hybridflow.createClassVersion(handle, id, { body, criteria, template, from }))));

    server.registerTool('class_patch_version', {
        description: 'Patch or publish a draft version. Published versions are immutable.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            versionId: VERSION_ID,
            patch: z.object({
                body: z.string().optional().describe('New description.'),
                criteria: CRITERIA.optional(),
                template: z.boolean().optional().describe('Fill body during instantiation.'),
                status: z.enum(['draft', 'published']).optional().describe('Publish the version.'),
            }).strict().describe('The fields to change.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, versionId, patch, ifMatch }) =>
        ok(await hybridflow.patchClassVersion(handle, id, versionId, patch, ifMatch))));

    server.registerTool('class_delete_version', {
        description: 'Permanently delete one class version.',
        inputSchema: { handle: HANDLE, id: CLASS_ID, versionId: VERSION_ID },
    }, guard(async ({ handle, id, versionId }) => ok(await hybridflow.deleteClassVersion(handle, id, versionId))));

    server.registerTool('class_instantiate', {
        description: 'Instantiate a class and its successors on the destination board. Complete task settings and schemas afterward; see hybridflow references/classes.md.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            spot: SPOT.optional(),
            bodies: BODIES,
            agents: z.record(z.string(), AGENT_ID).optional().describe("Explicit task agent IDs keyed by source class ID."),
        },
    }, guard(async ({ handle, id, spot, bodies, agents }) =>
        ok(await hybridflow.instantiateFlowNodeClass(handle, id, { spot, bodies, agents }))));

    // ── Agents ──────────────────────────────────────────────────────────────
    server.registerTool('agent_list', {
        description: 'List installed agent repositories and latest publications. Select using the published description.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.listAgents())));

    server.registerTool('agent_create', {
        description: 'Clone an agent Git repository or create a local agent. See hybridflow references/execution/agents.md.',
        inputSchema: {
            repository: z.string().optional().describe('Git repository URL; empty creates a local repository.'),
            name: z.string().optional().describe('Required for a new local agent.'),
            harness: z.enum(['claude', 'codex', 'muse', 'pi']).optional().describe('Required for a new local agent.'),
            profileId: z.string().optional().describe('Runner execution profile id; see the agents reference.'),
            model: z.string().optional().describe('Model id. Required before native-agent publication.'),
            effort: z.string().optional().describe('Default effort. Required before native-agent publication.'),
            instructions: z.string().optional().describe('Standing instructions sent to turns.'),
            description: z.string().optional().describe('Selection guidance; not sent to turns.'),
        },
    }, guard(async ({ repository, name, harness, profileId, model, effort, description, instructions }) =>
        ok(await hybridflow.createAgent({ repository, name, harness, profileId, model, effort, description, instructions }))));

    server.registerTool('agent_get', {
        description: 'Read one managed agent.',
        inputSchema: { id: AGENT_ID },
    }, guard(async ({ id }) => ok(await hybridflow.getAgent(id))));

    server.registerTool('agent_patch', {
        description: 'Edit an agent working tree. Publish configuration changes with agent_publish.',
        inputSchema: {
            id: AGENT_ID,
            patch: z.object({
                name: z.string().optional().describe('New unique name.'),
                harness: z.enum(['claude', 'codex', 'muse', 'pi']).optional().describe('New engine.'),
                profileId: z.string().optional().describe('New execution profile reference.'),
                effort: z.string().optional().describe('New default effort.'),
                model: z.string().optional().describe('New model, or empty for the CLI\'s own default.'),
                instructions: z.string().optional().describe('New standing orders.'),
                description: z.string().optional().describe('Selection guidance; empty clears.'),
            }).strict().describe('The fields to change.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ id, patch, ifMatch }) => ok(await hybridflow.patchAgent(id, patch, ifMatch))));

    server.registerTool('agent_publish', {
        description: 'Publish an agent release. If pushConfirmation is returned, present its dependencies to the owner before retrying.',
        inputSchema: {
            id: AGENT_ID,
            ifMatch: IF_MATCH,
            bump: z.enum(['major', 'minor', 'patch']).optional().describe('Version component to increase. Defaults to patch.'),
            confirmation: z.string().optional().describe('Push confirmation token, supplied after the owner accepts the warning.'),
        },
    }, guard(async ({ id, ifMatch, confirmation, bump }) => ok(await hybridflow.publishAgent(id, ifMatch, confirmation, bump))));

    server.registerTool('agent_versions', {
        description: 'Read Git agent publications, oldest first.',
        inputSchema: { id: AGENT_ID },
    }, guard(async ({ id }) => ok(await hybridflow.agentVersions(id))));

    server.registerTool('agent_delete', {
        description: 'Inspect clone deletion risks. Pass the returned confirmation only after the owner confirms deletion; task references are retained.',
        inputSchema: { id: AGENT_ID, confirmation: z.string().optional().describe('Fingerprint of the repository state the owner confirmed.') },
    }, guard(async ({ id, confirmation }) => ok(await hybridflow.deleteAgent(id, confirmation))));

    // ── Runners ─────────────────────────────────────────────────────────────
    server.registerTool('runner_list', {
        description: 'List runner registrations and last-seen timestamps.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.listRunners())));

    server.registerTool('runner_create', {
        description: 'Create a runner registration; this does not provision a machine.',
        inputSchema: { name: z.string().describe('Runner name.') },
    }, guard(async ({ name }) => ok(await hybridflow.createRunner({ name }))));

    server.registerTool('runner_get', {
        description: 'Read one runner registration.',
        inputSchema: { id: z.string().describe('Runner id from runner_list.') },
    }, guard(async ({ id }) => ok(await hybridflow.getRunner(id))));

    server.registerTool('runner_patch', {
        description: 'Rename a runner registration.',
        inputSchema: {
            id: z.string().describe('Runner id from runner_list.'),
            name: z.string().describe('New name.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ id, name, ifMatch }) => ok(await hybridflow.patchRunner(id, { name }, ifMatch))));

    server.registerTool('runner_delete', {
        description: 'Delete a runner registration; check task pins first.',
        inputSchema: { id: z.string().describe('Runner id from runner_list.') },
    }, guard(async ({ id }) => ok(await hybridflow.deleteRunner(id))));

    // ── Changes ─────────────────────────────────────────────────────────────
    server.registerTool('board_changes', {
        description: 'Read changes after a cursor; returns immediately. Continue from the returned cursor when more is true.',
        inputSchema: {
            since: z.number().int().optional().describe('Saved change cursor; omit for the beginning.'),
            board: z.string().optional().describe('Board id, not slug; omit for all boards.'),
            limit: z.number().int().optional().describe('Maximum page size.'),
        },
    }, guard(async ({ since, board, limit }) => ok(await hybridflow.getChanges(since, board, limit))));

    server.registerTool('hybridflow_schema', {
        description: 'Read the store migration ledger for deployment diagnosis.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.getSchema())));
}
