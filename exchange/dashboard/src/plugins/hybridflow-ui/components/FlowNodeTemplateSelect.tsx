import React from 'react';
import { Button, Select } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { Tooltip, useCentralStack } from '@cms-core';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { templateName } from '../flowNodeTemplates';
import { TemplateInstantiationPanel } from './TemplateInstantiationPanel';
import styles from '../Hybridflow.module.css';

/** The instantiation's entry on the central area's stack. */
export const TEMPLATE_INSTANTIATION_PANEL_ID = 'template-instantiation';

export const HELP = 'What the description is written from: a .temp.md file in flow-node-templates. Typing '
    + 'picks its own; instantiating asks, shows, then replaces the text. Current text lands at '
    + '${flowNodeDescription}.';

/**
 * The template a flow node is written from, and the button that writes it: a select of the store's
 * [flow node templates](../flowNodeTemplates.ts) and, beside it, the one gesture that instantiates the
 * picked one into the open flow node.
 *
 * It is a control of the flow node like the ones above it, and it is **the same control in both faces**
 * of the editor — the panel stacks it under the settings, the large editor lays it on the row over
 * the description. What it picks is held once, in the draft above them (`FlowNodeEditing-ctx`), so the
 * two agree: a card typed AI in the panel opens the large editor with `AI` already picked.
 *
 * It sits **immediately above the description** rather than among the settings, because that is
 * what it writes. The settings say what plays the flow node; this says what the flow node is written from.
 *
 * Instantiating **pushes a panel onto the central area's stack** rather than opening a dialog: the
 * form and its preview fill the middle of the screen, the chrome around them stays usable — the
 * file tree included, a file dragged out of it still landing where it is dropped — and closing
 * the panel is back where the flow node was, the large editor's panel or the board. Pushing twice is
 * pushing once: the button stays on screen behind the panel it opened.
 *
 * A path the folder no longer offers shows as nothing picked: a template deleted since it was
 * chosen is not a template, and the button that would write it is off.
 */
export const FlowNodeTemplateSelect: React.FC = () => {
    const { templates, templatePath, pickTemplate, editBody } = useFlowNodeEditing();
    const { push, close } = useCentralStack();

    const picked = templatePath && templates.includes(templatePath) ? templatePath : null;

    const instantiate = () => {
        if (!picked) return;
        const path = picked;
        push({
            id: TEMPLATE_INSTANTIATION_PANEL_ID,
            title: `Write the node from “${templateName(path)}”`,
            closeLabel: 'Cancel',
            content: (
                <TemplateInstantiationPanel
                    path={path}
                    // Through the editor's own call, like every other edit made here: the
                    // instantiation is the flow node being typed, not a document of its own.
                    onInstantiate={text => { editBody(text); close(TEMPLATE_INSTANTIATION_PANEL_ID); }}
                />
            ),
        });
    };

    return (
        <div className={styles.templateRow} data-testid="flow-node-template">
            <Tooltip title={HELP}>
                <Select
                    size="small"
                    className={styles.metaSelect}
                    value={picked ?? undefined}
                    placeholder="Template"
                    options={templates.map(path => ({ value: path, label: templateName(path) }))}
                    onChange={value => pickTemplate(value ?? null)}
                    aria-label="Template"
                    data-testid="flow-node-template-select"
                    classNames={{ popup: { root: styles.metaPopup } }}
                    popupMatchSelectWidth={false}
                    allowClear
                />
            </Tooltip>
            <Tooltip title="Write the description from this template">
                <Button
                    type="text"
                    size="small"
                    icon={<ThunderboltOutlined />}
                    aria-label="Instantiate template"
                    data-testid="instantiate-template"
                    disabled={!picked}
                    onClick={instantiate}
                />
            </Tooltip>
        </div>
    );
};
