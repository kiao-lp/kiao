import { FileDto, WorkerClient } from 'kiao-worker';
import { parseTempMd, serializeTempMd, TEMPLATE_EXTENSION, type TemplateCollectionV0 } from '@kiao-dashboard-kit/template-lang';
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

/** Clauses carry their own paragraph spacing. */
const AI_ROOT_TEXT = `\${noCode}
\${colleague}
\${${DESCRIPTION_VARIABLE}}
\${commit}`;

const AI_CLAUSES: [id: string, text: string][] = [
    ['noCode', 'In your exchanges with me, be as concise as possible and favor the strategic and'
        + ' tactical level (architecture and approach) over the code level (implementation). If you'
        + ' need to discuss code elements (intra-component), explain them in plain terms, clarifying'
        + ' their role and what they are.\n'],
    ['colleague', 'Write to me in the style of a colleague sending a teams message.\n'],
    ['commit', '\nOnce the work successfully completed, commit your changes, but do not push.'],
];

const HUMAN_ROOT_TEXT = `\${${DESCRIPTION_VARIABLE}}`;

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

/** Create missing defaults without overwriting user edits. */
export const ensureDefaultFlowNodeTemplates = async (client: WorkerClient): Promise<string[]> => {
    const found = await listFlowNodeTemplates(client);
    const named: [path: string, text: string][] = [
        [AI_TEMPLATE_PATH, serializeTempMd({
            name: 'AI',
            rootTemplate: { id: 'root', textTemplate: AI_ROOT_TEXT },
            subTemplates: AI_CLAUSES.map(([id, textTemplate]) => ({ id, textTemplate, defaultText: '' })),
        })],
        [HUMAN_TEMPLATE_PATH, serializeTempMd({
            name: 'Human',
            rootTemplate: { id: 'root', textTemplate: HUMAN_ROOT_TEXT },
            subTemplates: [],
        })],
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

export const parseDescriptionTemplate = (body: string): TemplateCollectionV0 =>
    parseTempMd(body, { fallbackToRoot: true });

/** Without a Root textTemplate block, the parser returns the whole description as Root. */
export const looksLikeDescriptionTemplate = (body: string): boolean =>
    parseDescriptionTemplate(body).rootTemplate.textTemplate !== body;

/** A description can contain ordinary Markdown headings even when it uses template variables. */
export const flowNodeBodyTemplate = (body: string, multiPart: boolean): TemplateCollectionV0 => {
    if (!multiPart) {
        return { rootTemplate: { id: 'root', textTemplate: body }, subTemplates: [] };
    }
    const { rootTemplate, subTemplates } = parseDescriptionTemplate(body);
    return { rootTemplate, subTemplates };
};
