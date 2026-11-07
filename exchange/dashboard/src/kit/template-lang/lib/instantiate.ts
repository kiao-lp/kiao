import { KiaoElHeap, kbElInstantiateText } from './kiao-expr-lang';
import { TemplateCollectionV0 } from './model';

/**
 * Instantiate a template by building a merged heap from sub-templates
 * and substituting all expressions.
 *
 * @param heap - The user-provided variable values
 * @param templateCollection - The template collection with root and sub-templates
 * @param enabledMap - Which optional sub-templates are enabled
 * @returns The fully instantiated text
 */
export const instantiateTemplate = (
    heap: KiaoElHeap,
    templateCollection: TemplateCollectionV0,
    enabledMap: Record<string, boolean>
): string => {
    // Construct merged heap
    const mergedHeap: KiaoElHeap = { ...heap };

    // Add sub-templates driven by enabledMap
    templateCollection.subTemplates.forEach(sub => {
        const hasDefault = sub.defaultText !== undefined && sub.defaultText !== null;
        const isEnabled = !hasDefault || enabledMap[sub.id];

        let value: string;
        if (isEnabled) {
            value = sub.textTemplate;
        } else {
            value = sub.defaultText || "";
        }

        mergedHeap[sub.id] = {
            type: "temp",
            value: value
        };
    });

    return kbElInstantiateText(mergedHeap, templateCollection.rootTemplate.textTemplate);
};
