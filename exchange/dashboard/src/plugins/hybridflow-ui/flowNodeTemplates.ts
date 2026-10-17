/**
 * Flow-node `.temp.md` templates live in a flat, user-editable folder. AI and Human
 * are selected by card type; missing defaults are created without overwriting existing files.
 * `${flowNodeDescription}` and `${flowNodeTitle}` receive the current card's values.
 * Both are optional: a template using neither replaces the description outright.
 */
import { FileDto, WorkerClient } from 'kiao-worker';
import { parseTempMd, TemplateCollectionV0 } from '@cms-kit/template-lang';
import { TEMPLATE_EXTENSION } from '../template-edit/instantiationTarget';
import { FlowNodeType } from './flowNodeType';

export const FLOW_NODE_TEMPLATES_PATH = 'kiao-user-config/flow-node-templates';

export const DESCRIPTION_VARIABLE = 'flowNodeDescription';
export const TITLE_VARIABLE = 'flowNodeTitle';

export const AI_TEMPLATE_PATH = `${FLOW_NODE_TEMPLATES_PATH}/AI${TEMPLATE_EXTENSION}`;
export const HUMAN_TEMPLATE_PATH = `${FLOW_NODE_TEMPLATES_PATH}/Human${TEMPLATE_EXTENSION}`;

/** Other types offer no default template and retain the manual selection. */
export const templateForType = (type: FlowNodeType): string | null => {
    if (type === 'ai') return AI_TEMPLATE_PATH;
    if (type === 'human') return HUMAN_TEMPLATE_PATH;
    return null;
};

/** Empty `defaultText` makes each clause optional, exposed as a checkbox. */
type Clause = [title: string, text: string];

/** Clauses carry their own paragraph spacing; headings determine their variable names. */
const AI_ROOT_TEXT = `\${noCode}
\${colleague}
\${${DESCRIPTION_VARIABLE}}
\${commit}`;

const AI_CLAUSES: Clause[] = [
    ['No code', 'In your exchanges with me, be as concise as possible and favor the strategic and'
        + ' tactical level (architecture and approach) over the code level (implementation). If you'
        + ' need to discuss code elements (intra-component), explain them in plain terms, clarifying'
        + ' their role and what they are.\n'],
    ['Colleague', 'Write to me in the style of a colleague sending a teams message.\n'],
    ['Commit', '\nOnce the work successfully completed, commit your changes, but do not push.'],
];

const HUMAN_ROOT_TEXT = `\${${DESCRIPTION_VARIABLE}}`;

const block = (label: string, text: string): string =>
    `### ${label}\n\n\`\`\`text\n${text}\n\`\`\`\n`;

const tempMd = (name: string, root: string, clauses: Clause[] = []): string =>
    `# ${name}\n\n## Root\n\n${block('textTemplate', root)}`
    + clauses.map(([title, text]) =>
        `\n## ${title}\n\n${block('defaultText', '')}\n${block('textTemplate', text)}`).join('');

export const templateName = (path: string): string => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    return name.endsWith(TEMPLATE_EXTENSION) ? name.slice(0, -TEMPLATE_EXTENSION.length) : name;
};

/** Sorted template paths; an absent folder is treated as empty. */
export const listFlowNodeTemplates = async (client: WorkerClient): Promise<string[]> => {
    const files: FileDto[] = await client.listFiles(FLOW_NODE_TEMPLATES_PATH).catch(() => []);
    return files
        .filter(file => !file.isDirectory && file.path.endsWith(TEMPLATE_EXTENSION))
        .map(file => file.path)
        .sort((left, right) => templateName(left).localeCompare(templateName(right)));
};

/**
 * Create missing defaults without overwriting user edits. Failed writes are omitted
 * from the returned list so unwritable stores can still use existing templates.
 */
export const ensureDefaultFlowNodeTemplates = async (client: WorkerClient): Promise<string[]> => {
    const found = await listFlowNodeTemplates(client);
    const named: [path: string, text: string][] = [
        [AI_TEMPLATE_PATH, tempMd('AI', AI_ROOT_TEXT, AI_CLAUSES)],
        [HUMAN_TEMPLATE_PATH, tempMd('Human', HUMAN_ROOT_TEXT)],
    ];
    const missing = named.filter(([path]) => !found.includes(path));
    if (!missing.length) return found;

    const written = await client.createFolder(FLOW_NODE_TEMPLATES_PATH)
        .catch(() => undefined)
        .then(() => Promise.all(missing.map(([path, text]) =>
            client.update(path, text)
                .then((): string | null => path)
                .catch(() => null))));
    return [...found, ...written.filter((path): path is string => path !== null)]
        .sort((left, right) => templateName(left).localeCompare(templateName(right)));
};

/** Load on selection rather than reading every template when the picker opens. */
export const loadFlowNodeTemplate = async (client: WorkerClient, path: string): Promise<TemplateCollectionV0> =>
    parseTempMd(await client.getFileText(path));

/**
 * Parse a class body as `.temp.md`, falling back to a plain-text Root to avoid losing
 * unstructured bodies. Instantiation fills `${flowNodeTitle}` with the class title
 * and `${flowNodeDescription}` with an empty string.
 */
export const versionBodyTemplate = (body: string, name: string): TemplateCollectionV0 => {
    const parsed = parseTempMd(body);
    if (parsed.rootTemplate.textTemplate === '' && parsed.subTemplates.length === 0 && body.trim() !== '') {
        return { name, index: '', rootTemplate: { id: 'root', textTemplate: body }, subTemplates: [] };
    }
    return { ...parsed, name: parsed.name || name };
};
