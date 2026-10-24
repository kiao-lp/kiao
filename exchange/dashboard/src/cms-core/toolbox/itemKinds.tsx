import React from 'react';
import { ApiOutlined, AppstoreOutlined, ToolOutlined } from '@ant-design/icons';
import { Tooltip } from '../ui/Tooltip';
import styles from './Toolbox.module.css';

/**
 * What the Configuration panel lists, in the one vocabulary the reader needs.
 *
 * The panel used to be cut in three — Runtimes, MCP servers, Plugins — each under its own title and
 * two of them in their own scrolling box. The distinction is real (the first two live on the
 * machine worker runs on and are installed there; the third is built into this build and
 * switched on per store) but it is *our* distinction, not the reader's: somebody looking for
 * "ffmpeg" or "mindmap" wants one list to look in. So the kinds stay, and become an icon on the row
 * and a chip in the filter bar rather than a division of the panel.
 */
export type ToolboxItemKind = 'runtime' | 'mcp' | 'plugin';

/** The order rows come in when nothing is filtered: the machine first, then the store. */
export const ITEM_KINDS: ToolboxItemKind[] = ['runtime', 'mcp', 'plugin'];

interface KindMeta {
    /** What the kind is called, for a screen reader and for the filter chip. */
    label: string;
    icon: React.ReactNode;
    /**
     * What the kind *means*, on the tooltip of every icon that carries it. This is where the
     * sentences the section titles used to introduce now live — a row explains itself, and the
     * explanation no longer costs a paragraph of the panel.
     */
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
        hint: 'Plugin — what this store opens files with. A file whose plugin is off still opens, '
            + 'as code or text; nothing is lost.',
    },
};

/** The icon a row wears in place of the section title it used to sit under. */
export const KindIcon: React.FC<{ kind: ToolboxItemKind }> = ({ kind }) => (
    <Tooltip title={KIND_META[kind].hint}>
        <span className={styles.rowIcon} aria-label={KIND_META[kind].label} role="img">
            {KIND_META[kind].icon}
        </span>
    </Tooltip>
);
