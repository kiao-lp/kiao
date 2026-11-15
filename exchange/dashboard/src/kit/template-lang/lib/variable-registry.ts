/**
 * VariableRegistry - Centralized variable collection from multiple templates
 *
 * This module provides abstractions for collecting and merging variables
 * from one or more templates, enabling shared variable state across templates.
 */

import { TemplateCollectionV0 } from './model';
import { extractKbElExpr, kbElExprParse } from './kiao-expr-lang';

/**
 * Represents a variable collected from templates
 */
export interface Variable {
    /** Root variable name (e.g., "user" for expressions like ${user.name}) */
    key: string;
    /** All raw expressions using this key across templates */
    expressions: string[];
    /** Template IDs that contain this variable */
    sourceTemplateIds: string[];
}

/**
 * A registry containing all variables from one or more templates
 */
export interface VariableRegistry {
    variables: Variable[];
}

/**
 * Recursively collect all expressions from a template and its sub-templates
 */
const collectExpressionsFromTemplate = (
    textTemplate: string,
    templateCollection: TemplateCollectionV0,
    visited: Set<string>
): { key: string; expression: string }[] => {
    const tokens = extractKbElExpr(textTemplate);
    const results: { key: string; expression: string }[] = [];

    for (const token of tokens) {
        const parsed = kbElExprParse(token);
        const rootKey = parsed.key.split('.')[0];

        results.push({ key: rootKey, expression: token });

        // Recurse into sub-templates
        if (!visited.has(rootKey)) {
            const subTemplate = templateCollection.subTemplates.find(t => t.id === rootKey);
            if (subTemplate) {
                visited.add(rootKey);
                const subResults = collectExpressionsFromTemplate(
                    subTemplate.textTemplate,
                    templateCollection,
                    visited
                );
                results.push(...subResults);
            }
        }
    }

    return results;
};

/**
 * Collect all variables from a single template
 */
export const collectVariablesFromTemplate = (template: TemplateCollectionV0): Variable[] => {
    const visited = new Set<string>();
    const expressions = collectExpressionsFromTemplate(
        template.rootTemplate.textTemplate,
        template,
        visited
    );

    // Group by key
    const variableMap = new Map<string, Variable>();
    const templateId = template.rootTemplate.id || 'root';

    for (const { key, expression } of expressions) {
        const existing = variableMap.get(key);
        if (existing) {
            if (!existing.expressions.includes(expression)) {
                existing.expressions.push(expression);
            }
        } else {
            variableMap.set(key, {
                key,
                expressions: [expression],
                sourceTemplateIds: [templateId]
            });
        }
    }

    return Array.from(variableMap.values());
};

/**
 * Merge two variable arrays, deduplicating by key and aggregating sources
 */
export const mergeVariables = (vars1: Variable[], vars2: Variable[]): Variable[] => {
    const merged = new Map<string, Variable>();

    for (const v of vars1) {
        merged.set(v.key, {
            key: v.key,
            expressions: [...v.expressions],
            sourceTemplateIds: [...v.sourceTemplateIds]
        });
    }

    for (const v of vars2) {
        const existing = merged.get(v.key);
        if (existing) {
            // Merge expressions (deduplicate)
            for (const expr of v.expressions) {
                if (!existing.expressions.includes(expr)) {
                    existing.expressions.push(expr);
                }
            }
            // Merge source IDs (deduplicate)
            for (const id of v.sourceTemplateIds) {
                if (!existing.sourceTemplateIds.includes(id)) {
                    existing.sourceTemplateIds.push(id);
                }
            }
        } else {
            merged.set(v.key, {
                key: v.key,
                expressions: [...v.expressions],
                sourceTemplateIds: [...v.sourceTemplateIds]
            });
        }
    }

    return Array.from(merged.values());
};

/**
 * Create a variable registry from one or more templates
 */
export const createVariableRegistry = (templates: TemplateCollectionV0[]): VariableRegistry => {
    let allVariables: Variable[] = [];

    for (const template of templates) {
        const templateVars = collectVariablesFromTemplate(template);
        allVariables = mergeVariables(allVariables, templateVars);
    }

    return { variables: allVariables };
};

