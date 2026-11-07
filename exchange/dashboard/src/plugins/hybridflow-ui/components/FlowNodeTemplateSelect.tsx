import React from 'react';
import { Button, Select } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { CENTER_2_BAR_ID, CENTER_BAR_ID, DOCUMENT_TAB_ID, Tooltip, useCentralStack, useToolBarsOptional } from '@cms-core';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { templateName } from '../flowNodeTemplates';
import { BOARD_TAB_ID } from '../constants';
import { TemplateInstantiationPanel } from './TemplateInstantiationPanel';
import styles from '../Hybridflow.module.css';

/** Panel id for template instantiation. */
export const TEMPLATE_INSTANTIATION_PANEL_ID = 'template-instantiation';

export const HELP = 'What the description is written from: a .temp.md file in flow-node-templates. Typing '
    + 'picks its own; instantiating asks, shows, then replaces the text. Current text lands at '
    + '${flowNodeDescription}.';

/** Template picker and instantiate button. */
export const FlowNodeTemplateSelect: React.FC<{ host?: string }> = ({ host: hostProp }) => {
    const { templates, templatePath, pickTemplate, editBody } = useFlowNodeEditing();
    const { push, close } = useCentralStack();
    const bars = useToolBarsOptional();

    const picked = templatePath && templates.includes(templatePath) ? templatePath : null;

    const instantiate = () => {
        if (!picked) return;
        const path = picked;
        const shown = [bars?.activeIn?.(CENTER_BAR_ID), bars?.activeIn?.(CENTER_2_BAR_ID)];
        const current = shown.includes(BOARD_TAB_ID) ? BOARD_TAB_ID
            : shown.includes(DOCUMENT_TAB_ID) ? DOCUMENT_TAB_ID : undefined;
        const host = hostProp ?? current;
        push({
            id: TEMPLATE_INSTANTIATION_PANEL_ID,
            host,
            title: `Write the node from “${templateName(path)}”`,
            closeLabel: 'Cancel',
            content: (
                <TemplateInstantiationPanel
                    path={path}
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
