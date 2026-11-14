import React from 'react';
import { ApiOutlined, AppstoreOutlined, ToolOutlined } from '@ant-design/icons';
import { Tooltip } from '../ui-foundation/feedback/Tooltip';
import styles from './Toolbox.module.css';

/** Item kinds in the Configuration panel list. */
export type ToolboxItemKind = 'runtime' | 'mcp' | 'plugin';

/** Unfiltered order: machine items, then store items. */
export const ITEM_KINDS: ToolboxItemKind[] = ['runtime', 'mcp', 'plugin'];

interface KindMeta {
    /** Label for screen readers and the filter chip. */
    label: string;
    icon: React.ReactNode;
    /** Tooltip text on the kind icon. */
    hint: string;
}

export const KIND_META: Record<ToolboxItemKind, KindMeta> = {
    runtime: {
        label: 'Runtime',
        icon: <ToolOutlined />,
        hint: 'Runtime — software the machine gains, which a turn or the service itself runs.',
    },
    mcp: {
        label: 'MCP server',
        icon: <ApiOutlined />,
        hint: 'MCP server — tools every Claude turn is handed while its switch is on.',
    },
    plugin: {
        label: 'Plugin',
        icon: <AppstoreOutlined />,
        hint: 'Opens supported file types; disabled plugins fall back to code or text.',
    },
};

/** Kind icon with tooltip. */
export const KindIcon: React.FC<{ kind: ToolboxItemKind }> = ({ kind }) => (
    <Tooltip title={KIND_META[kind].hint}>
        <span className={styles.rowIcon} aria-label={KIND_META[kind].label} role="img">
            {KIND_META[kind].icon}
        </span>
    </Tooltip>
);
