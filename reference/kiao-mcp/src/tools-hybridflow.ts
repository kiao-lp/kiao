import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { guard, ok } from './tools-common.js';
import type { HybridflowApi } from './hybridflow/api.js';

// Field schemas shared by the hybridflow tools.
//
// Their descriptions are part of every request's fixed cost: the tool list goes out with each one,
// so a rule is written once — on the tool that owns it, or on board_add_cards, the fullest use of
// the card fields — and the other sites name the field in a word and leave the rule where it was
// stated. The tools all live in this one server, so the model reads them in the same list either way.
const HANDLE = z.string()
    .describe('Board handle — the slug board_create answered (e.g. "major"). A rename does not move it.');
const CARD_ID = z.string()
    .describe('Card id, listed by board_get. Stable for the life of the card.');
const CLASS_ID = z.string()
    .describe('Node class id, listed by board_get or class_list.');
const VERSION_ID = z.string()
    .describe('Class version id, read off the class.');
const WORKFLOW_ID = z.string()
    .describe('Workflow id, listed by board_get.');
const AGENT_ID = z.string()
    .describe('Managed agent id, listed by agent_list.');

const TYPE = z.enum(['human', 'ai', 'shutdown', 'scheduler', 'gateway', 'note', 'value'])
    .describe('What kind of card it is. Write it — a shutdown, a scheduler or a gateway is nothing but its type. Only human and ai are tasks: the two with a body, criteria, complexity and a folder. A note holds markdown in note and nothing else; a value holds a title and JSON in value. A card created saying nothing is read as human.');
const NOTE = z.string().describe('Markdown on a note card, links included. A note card alone.');
const VALUE = z.unknown().describe('JSON payload on a value card. A value card alone.');
const TAGS = z.array(z.string())
    .describe('The words the card is filed under — the words themselves, never ids. Send the list the card is to wear, whole.');
const BODY = z.string()
    .describe('The description: what a play sends, markdown. A task\'s alone — written on a shutdown, a scheduler or a gateway, it is dropped.');
const CRITERIA = z.array(z.object({
    id: z.string().optional().describe('Mint one where the criterion has none.'),
    text: z.string().describe('What done means, in a line.'),
})).describe('What done means, sent with the prompt whenever present. Send the list whole.');
const COMPLEXITY = z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(5),
    z.literal(8), z.literal(13), z.literal(21),
]).describe('How heavy the work looks, in Fibonacci points — or omit for none. Optional, and never sent anywhere.');
const SETTINGS = z.object({
    agent: z.string().optional()
        .describe('Which agent plays the card — a managed agent\'s id. Read agent_list first; an id nothing holds is refused at the write.'),
    effort: z.string().optional()
        .describe('How hard it thinks, in that agent\'s vocabulary (low, medium, high, xhigh, max).'),
    permission: z.string().optional()
        .describe('How its tool calls are answered, in that agent\'s vocabulary.'),
    folder: z.string().optional()
        .describe('The folder the turn runs in, as a link from the store root with a leading slash — / for the root itself.'),
    runner: z.string().optional()
        .describe('Which runner plays the task — a runner\'s id, or absent for wherever a Play is pressed.'),
}).describe('What a turn is run with. All four of agent, effort, permission and folder, or the card is not played and nothing fills the missing one in; a human card is asked the folder alone. A whole replacement, never a patch: read the card, change one key, send all four back.');
const AT = z.string()
    .describe('A scheduler\'s datetime — YYYY-MM-DDTHH:mm, no zone, no seconds. Alternative to duration; setting one clears the other. Nothing on every other type.');
const DURATION = z.string().describe('Scheduler wait from each play, such as 30s, 15m or 1h30m. Positive h/m/s/ms components. Alternative to at; setting one clears the other. Empty clears it.');
const SPOT = z.object({
    x: z.number().int().min(0).describe('Pixels from the left of the canvas.'),
    y: z.number().int().min(0).describe('Pixels from the top of the canvas.'),
}).describe('Where the card sits. Omit it: the editor places a card nobody has placed, a card\'s width apart.');
const STATUS = z.enum(['draft', 'ready', 'blocked', 'running', 'waiting-refresh', 'interrupted', 'done', 'error'])
    .describe('draft, ready and blocked are yours to write — ready offers the card a turn. Never write running or waiting-refresh by hand: those say a run holds the card, and a card left saying so with no run behind it is stuck.');
const ON_SUCCESS = z.object({
    flowNode: z.string().optional()
        .describe('Id of the card played next — any card of the same board. Empty when nothing follows. Never on a shutdown or a gateway.'),
    flowNodes: z.array(z.string()).optional()
        .describe('The cards a gateway starts when it fires. A gateway\'s alone.'),
    mode: z.enum(['end', 'continue']).optional()
        .describe('Who gets the conversation: end (the default, the next card plays in a chat of its own) or continue (the chat is forked and the next card plays in the copy).'),
    compact: z.boolean().optional()
        .describe('Whether the chat is shortened when the card ends well. Absent is false.'),
}).describe('What is done after the card: the card played next, and what becomes of the chat. Only an AI card is asked the last two.');
const IF_MATCH = z.number().int().optional()
    .describe('The revision the read reported. The write lands on it or comes back 409 — send it whenever you read a card, thought about it, and are writing it back.');
const WORKFLOW_REF = z.string().optional()
    .describe('The workflow the card is grouped in — one of this board — or absent for none.');
const CLASS_ON_SUCCESS = z.object({
    flowNode: z.string().optional()
        .describe('Id of the class after this one — a class, never a version or a flow node.'),
    mode: z.enum(['end', 'continue']).optional()
        .describe('What becomes of an instance\'s chat. Only an AI class is asked.'),
    compact: z.boolean().optional()
        .describe('Whether an instance\'s chat is shortened when it ends well. Absent is false.'),
}).describe('The class after this one, and what becomes of an instance\'s chat.');
const BODIES = z.record(z.string()).optional()
    .describe('What the instantiated templates are asked instead of their version\'s body, by class id.');

/** Register the hybridflow tools on an MCP server. */
export function registerHybridflowTools(server: McpServer, hybridflow: HybridflowApi): void {
    // ── Boards ──────────────────────────────────────────────────────────────
    server.registerTool('board_list', {
        description: 'Every board — names and handles, nothing on them. Match on name and use the handle from then on.',
        inputSchema: {
            archived: z.boolean().optional().describe('Include the archived ones. Absent is live boards only.'),
        },
    }, guard(async ({ archived }) => ok(await hybridflow.listBoards(archived ?? false))));

    server.registerTool('board_create', {
        description: 'Create a board. Answers it whole — its handle among it, which board_get and the card tools take. The name must be free. A board is a row in the hybridflow-store, not a file: nothing is written to the store.',
        inputSchema: {
            name: z.string().describe('What the board is called. The handle is derived from it.'),
        },
    }, guard(async ({ name }) => ok(await hybridflow.createBoard(name))));

    server.registerTool('board_get', {
        description: 'Read one board whole — its cards, its node classes, its workflows and workflow classes, and the cursor it was read at. Read before changing: card ids, spots and revisions all come from this one answer.',
        inputSchema: { handle: HANDLE },
    }, guard(async ({ handle }) => ok(await hybridflow.getBoard(handle))));

    server.registerTool('board_patch', {
        description: 'Rename a board, archive or unarchive it. A rename does not move the handle.',
        inputSchema: {
            handle: HANDLE,
            name: z.string().optional().describe('New name. Must be free.'),
            archive: z.boolean().optional().describe('True puts the board away, false brings it back.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, name, archive, ifMatch }) =>
        ok(await hybridflow.patchBoard(handle, { name, archive }, ifMatch))));

    server.registerTool('board_delete', {
        description: 'Delete a board and everything on it — cards, classes, workflows. There is no undo.',
        inputSchema: { handle: HANDLE },
    }, guard(async ({ handle }) => ok(await hybridflow.deleteBoard(handle))));

    // ── Cards ───────────────────────────────────────────────────────────────
    server.registerTool('board_add_cards', {
        description: 'Add one or more cards to a board in one call, in the order given — which is what a paste is. Give each task a title AND a body: the title names the card, the body is the description a play sends — and a card with only a title is played on its name. A note card takes note alone; a value card takes title and value. Returns the cards with the ids they were given.',
        inputSchema: {
            handle: HANDLE,
            flowNodes: z.array(z.object({
                id: z.string().optional()
                    .describe('Leave out unless pasting: the service mints one. A paste keeps its ids so the chains among the pasted cards survive.'),
                title: z.string().optional()
                    .describe('What the card shows in bold — and the prompt where there is no body, never beside one.'),
                type: TYPE,
                tags: TAGS.optional(),
                note: NOTE.optional(),
                value: VALUE.optional(),
                body: BODY.optional(),
                criteria: CRITERIA.optional(),
                complexity: COMPLEXITY.optional(),
                settings: SETTINGS.optional(),
                at: AT.optional(),
                duration: DURATION.optional(),
                spot: SPOT.optional(),
                status: STATUS.optional(),
                archived: z.boolean().optional().describe('True hides the card everywhere without deleting it.'),
                onSuccess: ON_SUCCESS.optional(),
                workflow: WORKFLOW_REF,
            })).describe('The cards to add, in order.'),
        },
    }, guard(async ({ handle, flowNodes }) => ok(await hybridflow.createFlowNodes(handle, flowNodes))));

    server.registerTool('board_get_card', {
        description: 'Read one card — its fields, its revision, the run holding it if one does.',
        inputSchema: { handle: HANDLE, id: CARD_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getFlowNode(handle, id))));

    server.registerTool('board_patch_card', {
        description: 'Change the named fields of one card and nothing else — no read-modify-write of the whole card. Same fields as board_add_cards, stating the rules there; this one names the fields it changes. settings and tags are whole replacements: read the card, change one key, send all of them back. clearSpot takes a card off the board. Unknown fields are refused, not ignored.',
        inputSchema: {
            handle: HANDLE,
            id: CARD_ID,
            patch: z.object({
                title: z.string().optional().describe('New bold line.'),
                note: NOTE.optional(),
                value: VALUE.optional(),
                type: TYPE.optional(),
                tags: z.array(z.string()).optional().describe('The list the card is to wear, whole.'),
                body: z.string().optional().describe('New description.'),
                criteria: CRITERIA.optional(),
                complexity: COMPLEXITY.optional(),
                clearComplexity: z.boolean().optional().describe('Takes the estimation off, which a complexity of nothing cannot say.'),
                settings: SETTINGS.optional(),
                at: z.string().optional().describe('New datetime; a nonempty value clears duration.'),
                duration: DURATION.optional(),
                spot: SPOT.optional(),
                clearSpot: z.boolean().optional().describe('Takes the card off the board, which a spot of nothing cannot say.'),
                status: STATUS.optional(),
                archived: z.boolean().optional().describe('True hides the card everywhere without deleting it, false brings it back.'),
                onSuccess: ON_SUCCESS.optional(),
                classVersion: z.string().optional().describe('Binds the card to a class version, or breaks the link with "".'),
                workflow: z.string().optional().describe('Groups the card in the workflow it names, or takes it out with "".'),
            }).describe('The fields to change.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, patch, ifMatch }) => ok(await hybridflow.patchFlowNode(handle, id, patch, ifMatch))));

    server.registerTool('board_delete_cards', {
        description: 'Remove cards. Ask first: a card is minutes of somebody\'s thinking and there is no undo. A chain naming a deleted card is left pointing at nothing.',
        inputSchema: {
            handle: HANDLE,
            flowNodes: z.array(z.string()).describe('The card ids to remove.'),
        },
    }, guard(async ({ handle, flowNodes }) => ok(await hybridflow.deleteFlowNodes(handle, flowNodes))));

    server.registerTool('board_chain_card', {
        description: 'Link a card to the card played next, or unlink it. An empty target takes the link off. On a gateway the target is added to its branches, and an empty target takes them all off.',
        inputSchema: {
            handle: HANDLE,
            id: CARD_ID,
            flowNode: z.string().describe('Id of the card played next — any card of the same board. Empty unlinks.'),
        },
    }, guard(async ({ handle, id, flowNode }) => ok(await hybridflow.chainFlowNode(handle, id, flowNode))));

    server.registerTool('board_card_usage', {
        description: 'What one card spent, whole: the sums of its reports — tokens in and out, and the cost where a report priced itself.',
        inputSchema: { handle: HANDLE, id: CARD_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getFlowNodeUsage(handle, id))));

    server.registerTool('board_card_to_class', {
        description: 'File a node class from a task: the card\'s title, kind and answers become the class\'s, and its description and success criteria become the first version\'s.',
        inputSchema: { handle: HANDLE, id: CARD_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.convertFlowNodeToClass(handle, id))));

    // ── Workflows ───────────────────────────────────────────────────────────
    server.registerTool('workflow_create', {
        description: 'File a workflow on a board and group its cards in it. A workflow is a name round a set of cards — the rectangle the board draws round its members. Creating one with a card already grouped moves it.',
        inputSchema: {
            handle: HANDLE,
            name: z.string().optional().describe('What the workflow is called.'),
            flowNodes: z.array(z.string()).optional().describe('The cards it groups: flow nodes of this board.'),
        },
    }, guard(async ({ handle, name, flowNodes }) => ok(await hybridflow.createWorkflow(handle, { name, flowNodes }))));

    server.registerTool('workflow_get', {
        description: 'Read one workflow.',
        inputSchema: { handle: HANDLE, id: WORKFLOW_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getWorkflow(handle, id))));

    server.registerTool('workflow_patch', {
        description: 'Rename a workflow. Its members are untouched.',
        inputSchema: {
            handle: HANDLE,
            id: WORKFLOW_ID,
            name: z.string().describe('New name.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, name, ifMatch }) => ok(await hybridflow.patchWorkflow(handle, id, { name }, ifMatch))));

    server.registerTool('workflow_delete', {
        description: 'Remove workflows. Their cards are ungrouped and left where they are.',
        inputSchema: {
            handle: HANDLE,
            workflows: z.array(z.string()).describe('The workflow ids to remove.'),
        },
    }, guard(async ({ handle, workflows }) => ok(await hybridflow.deleteWorkflows(handle, workflows))));

    // ── Workflow classes ────────────────────────────────────────────────────
    server.registerTool('workflow_class_list', {
        description: 'Every workflow class of every board: what the instantiate menu lists beside the node classes.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.listWorkflowClasses())));

    server.registerTool('workflow_class_create', {
        description: 'File a workflow class on a board and group its classes in it. A workflow class is a name round a set of node classes.',
        inputSchema: {
            handle: HANDLE,
            name: z.string().optional().describe('What the workflow class is called.'),
            classes: z.array(z.string()).optional().describe('The node classes it groups: classes of this board.'),
        },
    }, guard(async ({ handle, name, classes }) => ok(await hybridflow.createWorkflowClass(handle, { name, classes }))));

    server.registerTool('workflow_class_get', {
        description: 'Read one workflow class.',
        inputSchema: {
            handle: HANDLE,
            id: z.string().describe('Workflow class id, listed by board_get.'),
        },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getWorkflowClass(handle, id))));

    server.registerTool('workflow_class_patch', {
        description: 'Rename a workflow class. Its members are untouched.',
        inputSchema: {
            handle: HANDLE,
            id: z.string().describe('Workflow class id, listed by board_get.'),
            name: z.string().describe('New name.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, name, ifMatch }) =>
        ok(await hybridflow.patchWorkflowClass(handle, id, { name }, ifMatch))));

    server.registerTool('workflow_class_delete', {
        description: 'Remove workflow classes. Their classes are ungrouped and left where they are.',
        inputSchema: {
            handle: HANDLE,
            workflowClasses: z.array(z.string()).describe('The workflow class ids to remove.'),
        },
    }, guard(async ({ handle, workflowClasses }) => ok(await hybridflow.deleteWorkflowClasses(handle, workflowClasses))));

    server.registerTool('workflow_class_instantiate', {
        description: 'Make a workflow from a workflow class — one flow node per member — on the board the handle names, which may be another board than the workflow class\'s own.',
        inputSchema: {
            handle: HANDLE,
            id: z.string().describe('Workflow class id, listed by workflow_class_list.'),
            spot: SPOT.optional(),
            bodies: BODIES,
        },
    }, guard(async ({ handle, id, spot, bodies }) =>
        ok(await hybridflow.instantiateWorkflowClass(handle, id, { spot, bodies }))));

    // ── Node classes ────────────────────────────────────────────────────────
    server.registerTool('class_list', {
        description: 'Every node class of every board: what the instantiate menu lists. Match on title and board, then class_get for the succession.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.listFlowNodeClasses())));

    server.registerTool('class_create', {
        description: 'File a node class on a board: the reusable card, with its first version\'s words beside it. A class holds what every instance shares — no folder, no effort, no chat, no body of its own; those are its versions\' and its instances\'. A gateway holds no reusable words, so the service refuses one.',
        inputSchema: {
            handle: HANDLE,
            title: z.string().describe('What the class is called.'),
            instantiable: z.boolean().optional().describe('Offer the class in the Instantiate menu. Absent is off.'),
            type: TYPE.optional(),
            tags: TAGS.optional(),
            body: z.string().optional().describe('The first version\'s description.'),
            criteria: CRITERIA.optional(),
            template: z.boolean().optional().describe('The first version\'s body is a template to fill in on instantiation.'),
            agent: z.string().optional().describe('The first version\'s default agent — a managed agent\'s id. Asked of an AI class\'s versions alone.'),
            at: AT.optional(),
            duration: DURATION.optional(),
            spot: SPOT.optional(),
            permission: z.string().optional().describe('How an AI instance\'s tool calls are answered. Asked of an AI class alone.'),
            runner: z.string().optional().describe('Which runner plays an AI instance — a runner\'s id, or empty. Asked of an AI class alone.'),
            note: z.string().optional().describe('What the class is for. Copied to no instance.'),
            onSuccess: CLASS_ON_SUCCESS.optional(),
            published: z.boolean().optional().describe('Freeze the first version at creation.'),
            workflowClass: z.string().optional().describe('The workflow class the class is grouped in — one of this board.'),
        },
    }, guard(async ({ handle, ...rest }) => ok(await hybridflow.createFlowNodeClass(handle, rest))));

    server.registerTool('class_get', {
        description: 'Read one node class, with its succession beneath it — oldest first, each with its number, status and revision.',
        inputSchema: { handle: HANDLE, id: CLASS_ID },
    }, guard(async ({ handle, id }) => ok(await hybridflow.getFlowNodeClass(handle, id))));

    server.registerTool('class_patch', {
        description: 'Change a class\'s own fields — never its versions\': a new description is a new version, not a patch. Only an AI class is asked permission, runner and what becomes of an instance\'s chat.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            patch: z.object({
                title: z.string().optional().describe('New title.'),
                instantiable: z.boolean().optional().describe('Offer the class in the Instantiate menu.'),
                type: TYPE.optional(),
                tags: z.array(z.string()).optional().describe('The list the class is to wear, whole.'),
                at: z.string().optional().describe('New preset datetime; a nonempty value clears duration.'),
                duration: DURATION.optional(),
                onSuccess: CLASS_ON_SUCCESS.optional(),
                permission: z.string().optional().describe('How an AI instance\'s tool calls are answered.'),
                runner: z.string().optional().describe('Which runner plays an AI instance.'),
                note: z.string().optional().describe('New note.'),
                spot: SPOT.optional(),
                clearSpot: z.boolean().optional().describe('Takes the class off the board.'),
                workflowClass: z.string().optional().describe('Groups the class in the workflow class it names, or takes it out with "".'),
            }).describe('The fields to change.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, patch, ifMatch }) => ok(await hybridflow.patchFlowNodeClass(handle, id, patch, ifMatch))));

    server.registerTool('class_delete', {
        description: 'Remove node classes and their versions. Ask first: there is no undo.',
        inputSchema: {
            handle: HANDLE,
            flowNodeClasses: z.array(z.string()).describe('The class ids to remove.'),
        },
    }, guard(async ({ handle, flowNodeClasses }) => ok(await hybridflow.deleteFlowNodeClasses(handle, flowNodeClasses))));

    server.registerTool('class_chain', {
        description: 'Link a class to the class after it — a class, never a version or a flow node — or unlink it. An empty target takes the link off.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            flowNode: z.string().describe('Id of the class after this one. Empty unlinks.'),
        },
    }, guard(async ({ handle, id, flowNode }) => ok(await hybridflow.chainFlowNodeClass(handle, id, flowNode))));

    server.registerTool('class_create_version', {
        description: 'File one version under its class — a blank draft, or copied from the version from names. An instantiated flow node arrives from the latest version that is not a draft.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            body: z.string().optional().describe('The description.'),
            criteria: CRITERIA.optional(),
            template: z.boolean().optional().describe('The body is a template to fill in on instantiation.'),
            agent: z.string().optional().describe('The default agent — a managed agent\'s id. Asked of an AI class\'s versions alone.'),
            from: z.string().optional().describe('Copy the words from this version. Empty is a blank draft.'),
        },
    }, guard(async ({ handle, id, body, criteria, template, agent, from }) =>
        ok(await hybridflow.createClassVersion(handle, id, { body, criteria, template, agent, from }))));

    server.registerTool('class_patch_version', {
        description: 'Change what a draft says, or publish it. A published version is refused whatever is sent, and is never drafted again.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            versionId: VERSION_ID,
            patch: z.object({
                body: z.string().optional().describe('New description.'),
                criteria: CRITERIA.optional(),
                template: z.boolean().optional().describe('The body is a template to fill in on instantiation.'),
                agent: z.string().optional().describe('The default agent.'),
                status: z.enum(['draft', 'published']).optional().describe('Publish the version.'),
            }).describe('The fields to change.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ handle, id, versionId, patch, ifMatch }) =>
        ok(await hybridflow.patchClassVersion(handle, id, versionId, patch, ifMatch))));

    server.registerTool('class_delete_version', {
        description: 'Delete one class version.',
        inputSchema: { handle: HANDLE, id: CLASS_ID, versionId: VERSION_ID },
    }, guard(async ({ handle, id, versionId }) => ok(await hybridflow.deleteClassVersion(handle, id, versionId))));

    server.registerTool('class_instantiate', {
        description: 'Make flow nodes from a class and all its successors — each from its latest published version — on the board the handle names, which may be another board than the class\'s own. An instantiated AI flow node arrives naming no effort and no folder: pick both before it can be played.',
        inputSchema: {
            handle: HANDLE,
            id: CLASS_ID,
            spot: SPOT.optional(),
            bodies: BODIES,
        },
    }, guard(async ({ handle, id, spot, bodies }) =>
        ok(await hybridflow.instantiateFlowNodeClass(handle, id, { spot, bodies }))));

    // ── Agents ──────────────────────────────────────────────────────────────
    server.registerTool('agent_list', {
        description: 'List active managed agents with their draft and latest publication. Only published agents can start task conversations. Archived agents are hidden unless requested.',
        inputSchema: { archived: z.boolean().optional().describe('Include archived agents.') },
    }, guard(async ({ archived }) => ok(await hybridflow.listAgents(archived))));

    server.registerTool('agent_create', {
        description: 'Create an unpublished agent draft. Configure it, then agent_publish before starting a task conversation. The name must be free.',
        inputSchema: {
            name: z.string().describe('What the flow node editor shows. Unique across the store, however it is cased.'),
            platform: z.enum(['claude', 'codex', 'muse', 'opencode', 'pi']).describe('The engine the agent runs on.'),
            profileId: z.string().optional().describe('Execution profile on the runner; required for Pi unless a Pi default is configured.'),
            model: z.string().optional().describe('The model the agent runs on, or empty for the CLI\'s own default.'),
            instructions: z.string().optional().describe('Standing orders its turns are given, beside the prompt.'),
            description: z.string().optional().describe('When to choose this agent for a task. Separate from instructions and never sent to its turns.'),
        },
    }, guard(async ({ name, platform, profileId, model, description, instructions }) =>
        ok(await hybridflow.createAgent({ name, platform, profileId, model, description, instructions }))));

    server.registerTool('agent_get', {
        description: 'Read one managed agent.',
        inputSchema: { id: AGENT_ID },
    }, guard(async ({ id }) => ok(await hybridflow.getAgent(id))));

    server.registerTool('agent_patch', {
        description: 'Edit an agent draft, or archive/restore the agent. Configuration edits take effect for new conversations only after agent_publish.',
        inputSchema: {
            id: AGENT_ID,
            patch: z.object({
                archived: z.boolean().optional().describe('Hide the agent, or restore it. Existing conversations keep their version.'),
                name: z.string().optional().describe('New name. Must be free.'),
                platform: z.enum(['claude', 'codex', 'muse', 'opencode', 'pi']).optional().describe('New engine.'),
                profileId: z.string().optional().describe('New execution profile reference.'),
                model: z.string().optional().describe('New model, or empty for the CLI\'s own default.'),
                instructions: z.string().optional().describe('New standing orders.'),
                description: z.string().optional().describe('When to choose this agent for a task; never sent to its turns. Empty clears it.'),
            }).describe('The fields to change.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ id, patch, ifMatch }) => ok(await hybridflow.patchAgent(id, patch, ifMatch))));

    server.registerTool('agent_publish', {
        description: 'Publish the current agent draft as an immutable numbered version. New task conversations select this publication; existing conversations retain theirs.',
        inputSchema: { id: AGENT_ID, ifMatch: IF_MATCH },
    }, guard(async ({ id, ifMatch }) => ok(await hybridflow.publishAgent(id, ifMatch))));

    server.registerTool('agent_versions', {
        description: 'Read all published configurations of an agent, including archived agents, oldest first.',
        inputSchema: { id: AGENT_ID },
    }, guard(async ({ id }) => ok(await hybridflow.agentVersions(id))));

    server.registerTool('agent_delete', {
        description: 'Delete an unpublished agent. Published agents must be archived to retain their history. Ask before deleting.',
        inputSchema: { id: AGENT_ID },
    }, guard(async ({ id }) => ok(await hybridflow.deleteAgent(id))));

    // ── Runners ─────────────────────────────────────────────────────────────
    server.registerTool('runner_list', {
        description: 'Every runner: the machines that play cards, and when each last said it was alive.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.listRunners())));

    server.registerTool('runner_create', {
        description: 'File a runner.',
        inputSchema: { name: z.string().describe('What the task editor shows.') },
    }, guard(async ({ name }) => ok(await hybridflow.createRunner({ name }))));

    server.registerTool('runner_get', {
        description: 'Read one runner.',
        inputSchema: { id: z.string().describe('Runner id, listed by runner_list.') },
    }, guard(async ({ id }) => ok(await hybridflow.getRunner(id))));

    server.registerTool('runner_patch', {
        description: 'Rename a runner.',
        inputSchema: {
            id: z.string().describe('Runner id, listed by runner_list.'),
            name: z.string().describe('New name.'),
            ifMatch: IF_MATCH,
        },
    }, guard(async ({ id, name, ifMatch }) => ok(await hybridflow.patchRunner(id, { name }, ifMatch))));

    server.registerTool('runner_delete', {
        description: 'Delete a runner.',
        inputSchema: { id: z.string().describe('Runner id, listed by runner_list.') },
    }, guard(async ({ id }) => ok(await hybridflow.deleteRunner(id))));

    // ── Changes ─────────────────────────────────────────────────────────────
    server.registerTool('board_changes', {
        description: 'What happened after a cursor — the board\'s changes since board_get\'s cursor. Answers at once; a client that draws a board asks again from the cursor it answers.',
        inputSchema: {
            since: z.number().int().optional().describe('The cursor board_get reported. Absent is the beginning.'),
            board: z.string().optional().describe('The board id. Absent is every board.'),
            limit: z.number().int().optional().describe('At most this many changes; more says to ask again at once.'),
        },
    }, guard(async ({ since, board, limit }) => ok(await hybridflow.getChanges(since, board, limit))));

    server.registerTool('hybridflow_schema', {
        description: 'The migration ledger: which version the store is on.',
        inputSchema: {},
    }, guard(async () => ok(await hybridflow.getSchema())));
}
