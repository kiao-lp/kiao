import React from 'react';
import { Button, Dropdown } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { CENTER_2_BAR_ID, CENTER_BAR_ID, DOCUMENT_TAB_ID, Tooltip, useCentralStack, useToolBarsOptional } from '@kiao-dashboard-core';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { templateName } from '../flowNodeTemplates';
import { BOARD_TAB_ID } from '../constants';
import { TemplateInstantiationPanel } from './TemplateInstantiationPanel';

/** Panel id for template instantiation. */
export const TEMPLATE_INSTANTIATION_PANEL_ID = 'template-instantiation';

export const HELP = 'Write the description from a template';

/** Choosing a template opens its instantiation panel. */
export const FlowNodeTemplateMenu: React.FC = () => {
    const { templates, templatePath, pickTemplate, editBody } = useFlowNodeEditing();
    const { push, close } = useCentralStack();
    const bars = useToolBarsOptional();

    const picked = templatePath && templates.includes(templatePath) ? templatePath : null;

    const instantiate = (path: string) => {
        pickTemplate(path);
        const shown = [bars?.activeIn?.(CENTER_BAR_ID), bars?.activeIn?.(CENTER_2_BAR_ID)];
        const host = shown.includes(BOARD_TAB_ID) ? BOARD_TAB_ID
            : shown.includes(DOCUMENT_TAB_ID) ? DOCUMENT_TAB_ID : undefined;
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
        <Dropdown
            trigger={['click']}
            placement="bottomRight"
            disabled={templates.length === 0}
            menu={{
                items: templates.map(path => ({ key: path, label: templateName(path) })),
                selectable: true,
                selectedKeys: picked ? [picked] : [],
                onClick: ({ key }) => instantiate(key),
            }}
        >
            <Tooltip title={HELP}>
                <Button
                    type="text"
                    size="small"
                    icon={<ThunderboltOutlined />}
                    aria-label="Instantiate template"
                    aria-haspopup="menu"
                    data-testid="instantiate-template"
                    disabled={templates.length === 0}
                />
            </Tooltip>
        </Dropdown>
    );
};
