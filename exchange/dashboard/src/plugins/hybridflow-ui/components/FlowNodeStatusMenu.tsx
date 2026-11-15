import React from 'react';
import { Button, Dropdown } from 'antd';
import { Tooltip } from '@kiao-dashboard-core';
import { STATUS_LABELS, type FlowNodeStatus } from '../flowNodeStatus';
import { STATUS_GLYPH } from '../flowNodeStatusGlyph';
import { STATUS_HELP } from './FlowNodeControls';
import styles from '../Hybridflow.module.css';

export const FlowNodeStatusMenu: React.FC<{
    status: FlowNodeStatus;
    onChange: (next: FlowNodeStatus) => void;
}> = ({ status, onChange }) => (
    <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{
            items: (Object.keys(STATUS_LABELS) as FlowNodeStatus[]).map(value => ({
                key: value,
                icon: <span className={styles.statusTone} data-status={value} aria-hidden="true">{STATUS_GLYPH[value]}</span>,
                label: <span className={styles.statusTone} data-status={value}>{STATUS_LABELS[value]}</span>,
            })),
            selectable: true,
            selectedKeys: [status],
            onClick: ({ key }) => onChange(key as FlowNodeStatus),
        }}
    >
        <Tooltip title={`${STATUS_LABELS[status]} — ${STATUS_HELP}`}>
            <Button
                type="text"
                size="small"
                icon={<span className={styles.statusTone} data-status={status}>{STATUS_GLYPH[status]}</span>}
                aria-label="Status"
                aria-haspopup="menu"
                data-testid="flow-node-status"
                data-status={status}
            />
        </Tooltip>
    </Dropdown>
);
