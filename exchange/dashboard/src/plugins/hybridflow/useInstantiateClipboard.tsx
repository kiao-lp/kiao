import React, { useCallback, useEffect } from 'react';
import { useCentralStack } from '@kiao-dashboard-core';
import { TemplateInstantiation } from '@kiao-dashboard-kit/template-fields';
import { extractKbElExpr, kbElExprParse } from '@kiao-dashboard-kit/template-lang';
import { BOARD_TAB_ID } from './constants';
import { readSettings } from './flowNodeSettings';
import { flowNodeBodyTemplate } from './flowNodeTemplates';
import { isTask, readType } from './flowNodeType';

const PANEL_ID = 'clipboard-template-instantiation';

// Individual nodes have already been decoded. Workflow members still have their clipboard shape.
const templateOf = (node: unknown) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    const { title, type, settings, body, multiPartTemplate } = node as Record<string, unknown>;
    if (!isTask(readType(type, readSettings(settings)))) return null;
    const text = typeof body === 'string' ? body : '';
    const multiPart = multiPartTemplate === true;
    if (!multiPart && !extractKbElExpr(text).some(token => kbElExprParse(token).key.trim())) return null;
    const name = typeof title === 'string' && title ? title : 'Untitled';
    return { name, template: flowNodeBodyTemplate(text, multiPart) };
};

export const useInstantiateClipboard = (handle: string | null) => {
    const { push, close } = useCentralStack();

    useEffect(() => () => close(PANEL_ID), [close, handle]);

    return useCallback(<Node,>(nodes: Node[], finish: (filled: Node[]) => void) => {
        const steps = nodes.flatMap((node, index) => {
            const step = templateOf(node);
            return step ? [{ ...step, index }] : [];
        });
        if (steps.length === 0) {
            finish(nodes);
            return;
        }

        const filled = [...nodes];
        const open = (position: number) => {
            const { index, name, template } = steps[position];
            let accepted = false;
            push({
                id: PANEL_ID,
                host: BOARD_TAB_ID,
                title: `Instantiate “${name}”` + (steps.length > 1 ? ` (${position + 1} of ${steps.length})` : ''),
                closeLabel: 'Cancel',
                content: (
                    <TemplateInstantiation
                        template={template}
                        copyDisabled
                        onInstantiate={body => {
                            if (accepted) return;
                            accepted = true;
                            filled[index] = { ...nodes[index], body, multiPartTemplate: false };
                            if (position + 1 < steps.length) open(position + 1);
                            else {
                                close(PANEL_ID);
                                finish(filled);
                            }
                        }}
                    />
                ),
            });
        };
        open(0);
    }, [close, push]);
};
