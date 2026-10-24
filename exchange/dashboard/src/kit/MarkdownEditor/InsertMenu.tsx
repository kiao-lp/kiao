import React, { useState } from 'react';
import { theme } from 'antd';
import {
    InsertRowBelowOutlined,
    InsertRowRightOutlined,
    AlignLeftOutlined,
    PartitionOutlined,
    SwapOutlined,
    ApartmentOutlined,
    NodeIndexOutlined,
    DatabaseOutlined,
    BarChartOutlined,
    PieChartOutlined,
} from '@ant-design/icons';
import { MERMAID_TEMPLATES } from './mermaidTemplates';

const MAX_ROWS = 8;
const MAX_COLS = 8;

const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const glyph = isMac
    ? { mod: '⌘', shift: '⇧', alt: '⌥', enter: '⏎', sep: '' }
    : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', enter: 'Enter', sep: '+' };

/** Human-readable shortcut hints, matching the CodeMirror keymap. */
export const TABLE_SHORTCUTS = {
    insertRow: [glyph.mod, glyph.enter].join(glyph.sep),
    insertColumn: [glyph.mod, glyph.shift, glyph.enter].join(glyph.sep),
    format: [glyph.shift, glyph.alt, 'F'].join(glyph.sep),
};

/** Per-diagram icons, keyed by the mermaid template key. */
const DIAGRAM_ICON: Record<string, React.ReactNode> = {
    flowchart: <PartitionOutlined />,
    sequence: <SwapOutlined />,
    class: <ApartmentOutlined />,
    state: <NodeIndexOutlined />,
    er: <DatabaseOutlined />,
    gantt: <BarChartOutlined />,
    pie: <PieChartOutlined />,
};

export interface InsertMenuProps {
    onInsertTable: (rows: number, cols: number) => void;
    onInsertRow: () => void;
    onInsertColumn: () => void;
    onFormat: () => void;
    /** Insert a mermaid diagram from its (unfenced) template body. */
    onInsertDiagram: (templateBody: string) => void;
    /** Whether the caret is inside a table (enables the contextual actions). */
    inTable: boolean;
    /** Dismiss the popup after an action. */
    onClose: () => void;
}

interface ActionRowProps {
    icon: React.ReactNode;
    label: string;
    shortcut?: string;
    disabled?: boolean;
    onClick: () => void;
}

/**
 * Content-insertion popup for the markdown toolbar: a hover-to-size grid plus
 * contextual table actions, and a list of mermaid diagram starters. Rendered as
 * a Dropdown `popupRender` overlay so the grid and the menu rows share one panel.
 */
export const InsertMenu: React.FC<InsertMenuProps> = ({
    onInsertTable,
    onInsertRow,
    onInsertColumn,
    onFormat,
    onInsertDiagram,
    inTable,
    onClose,
}) => {
    const { token } = theme.useToken();
    const [hover, setHover] = useState<{ r: number; c: number } | null>(null);

    const ActionRow: React.FC<ActionRowProps> = ({ icon, label, shortcut, disabled, onClick }) => {
        const [hovered, setHovered] = useState(false);
        return (
            <div
                role="menuitem"
                aria-disabled={disabled}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onClick={disabled ? undefined : onClick}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 10px',
                    borderRadius: token.borderRadiusSM,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    color: disabled ? token.colorTextDisabled : token.colorText,
                    background: hovered && !disabled ? token.controlItemBgHover : 'transparent',
                    userSelect: 'none',
                }}
            >
                <span style={{ display: 'flex', fontSize: 14, color: token.colorTextSecondary }}>{icon}</span>
                <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>
                {shortcut && (
                    <span style={{ color: token.colorTextTertiary, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {shortcut}
                    </span>
                )}
            </div>
        );
    };

    const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <div style={{ padding: '2px 10px 4px', color: token.colorTextSecondary, fontSize: 12 }}>
            {children}
        </div>
    );

    const divider = <div style={{ height: 1, background: token.colorBorderSecondary, margin: '8px 0' }} />;

    const cell = 18;
    const gap = 3;
    const rows = Array.from({ length: MAX_ROWS });
    const cols = Array.from({ length: MAX_COLS });

    return (
        <div
            style={{
                background: token.colorBgElevated,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadiusLG,
                boxShadow: token.boxShadowSecondary,
                padding: 8,
                width: 'max-content',
                maxHeight: '70vh',
                overflowY: 'auto',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '2px 10px 6px',
                    color: token.colorTextSecondary,
                    fontSize: 12,
                }}
            >
                <span>Insert table</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {hover ? `${hover.r + 1} × ${hover.c + 1}` : ''}
                </span>
            </div>
            <div
                onMouseLeave={() => setHover(null)}
                style={{ display: 'flex', flexDirection: 'column', gap, padding: '0 10px' }}
            >
                {rows.map((_, r) => (
                    <div key={r} style={{ display: 'flex', gap }}>
                        {cols.map((__, c) => {
                            const active = hover !== null && r <= hover.r && c <= hover.c;
                            return (
                                <div
                                    key={c}
                                    onMouseEnter={() => setHover({ r, c })}
                                    onClick={() => {
                                        onInsertTable(r + 1, c + 1);
                                        onClose();
                                    }}
                                    style={{
                                        width: cell,
                                        height: cell,
                                        borderRadius: 2,
                                        cursor: 'pointer',
                                        border: `1px solid ${active ? token.colorPrimary : token.colorBorder}`,
                                        background: active ? token.colorPrimaryBg : token.colorBgContainer,
                                    }}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
            {divider}
            <ActionRow
                icon={<InsertRowBelowOutlined />}
                label="Insert row below"
                shortcut={TABLE_SHORTCUTS.insertRow}
                disabled={!inTable}
                onClick={() => {
                    onInsertRow();
                    onClose();
                }}
            />
            <ActionRow
                icon={<InsertRowRightOutlined />}
                label="Insert column right"
                shortcut={TABLE_SHORTCUTS.insertColumn}
                disabled={!inTable}
                onClick={() => {
                    onInsertColumn();
                    onClose();
                }}
            />
            <ActionRow
                icon={<AlignLeftOutlined />}
                label="Format tables"
                shortcut={TABLE_SHORTCUTS.format}
                onClick={() => {
                    onFormat();
                    onClose();
                }}
            />
            {divider}
            <SectionLabel>Insert diagram</SectionLabel>
            {MERMAID_TEMPLATES.map((t) => (
                <ActionRow
                    key={t.key}
                    icon={DIAGRAM_ICON[t.key]}
                    label={t.label}
                    onClick={() => {
                        onInsertDiagram(t.body);
                        onClose();
                    }}
                />
            ))}
        </div>
    );
};
