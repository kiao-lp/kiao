import { TemplateCollectionV0 } from './model';
import { extractKbElExpr, kbElExprParse } from './kiao-expr-lang';

export interface RenderNode {
    type: 'group' | 'field';
    key: string;
    token: string;
    isEnabled?: boolean;
    hasDefault?: boolean;
    children?: RenderNode[];
    /** Optional: tracks which template this node originates from */
    sourceTemplateId?: string;
}

export const collectRenderNodes = (
    textTemplate: string,
    templateCollection: TemplateCollectionV0,
    enabledMap: Record<string, boolean>,
    seenKeys: Set<string>,
    sourceTemplateId?: string
): RenderNode[] => {
    const tokens = extractKbElExpr(textTemplate);
    const nodes: RenderNode[] = [];

    for (const token of tokens) {
        const parsed = kbElExprParse(token);
        const rootKey = parsed.key.split('.')[0];

        if (seenKeys.has(rootKey)) continue;
        seenKeys.add(rootKey);

        const subTemplate = templateCollection.subTemplates.find(t => t.id === rootKey);

        if (subTemplate) {
            const hasDefault = subTemplate.defaultText !== undefined && subTemplate.defaultText !== null;
            const isEnabled = !hasDefault || !!enabledMap[rootKey];

            let children: RenderNode[] = [];
            // If enabled, we traverse children and mark their keys as seen.
            // If disabled, we DO NOT traverse children, so their keys are NOT marked as seen.
            // This allows subsequent occurrences of the same key (in other branches) to be picked up.
            if (isEnabled) {
                children = collectRenderNodes(subTemplate.textTemplate, templateCollection, enabledMap, seenKeys, sourceTemplateId);
            }

            nodes.push({
                type: 'group',
                key: rootKey,
                token,
                isEnabled,
                hasDefault,
                children,
                sourceTemplateId
            });
        } else {
            nodes.push({
                type: 'field',
                key: rootKey,
                token,
                sourceTemplateId
            });
        }
    }
    return nodes;
};

/**
 * Collect render nodes from multiple templates, deduplicating variables by key
 * across all templates. Variables with the same key are shared.
 */
export const collectRenderNodesFromAll = (
    templates: TemplateCollectionV0[],
    enabledMap: Record<string, boolean>
): RenderNode[] => {
    const seenKeys = new Set<string>();
    const allNodes: RenderNode[] = [];

    for (const template of templates) {
        const templateId = template.rootTemplate.id || template.name || 'unnamed';
        const nodes = collectRenderNodes(
            template.rootTemplate.textTemplate,
            template,
            enabledMap,
            seenKeys,
            templateId
        );
        allNodes.push(...nodes);
    }

    return allNodes;
};
