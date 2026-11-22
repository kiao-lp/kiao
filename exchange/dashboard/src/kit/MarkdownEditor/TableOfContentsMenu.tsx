import React, { useMemo, useState } from 'react';
import { Button, Dropdown, theme } from 'antd';
import { OrderedListOutlined } from '@ant-design/icons';
import { markdownHeadings, type MarkdownHeading } from './tableOfContents';

export interface TableOfContentsMenuProps {
    /** Markdown source; the headings are read from it. */
    value: string;
    /** Called with the heading's 1-based source line when one is picked. */
    onNavigate: (line: number) => void;
}

const HeadingRow: React.FC<{ heading: MarkdownHeading; onPick: () => void }> = ({ heading, onPick }) => {
    const { token } = theme.useToken();
    const [hovered, setHovered] = useState(false);
    return (
        <div
            role="menuitem"
            tabIndex={0}
            onClick={onPick}
            onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                onPick();
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                padding: `3px 8px 3px ${8 + (heading.level - 1) * 14}px`,
                borderRadius: token.borderRadiusSM,
                cursor: 'pointer',
                color: token.colorText,
                background: hovered ? token.controlItemBgHover : 'transparent',
                fontSize: heading.level <= 2 ? 13 : 12,
                fontWeight: heading.level <= 2 ? 600 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                userSelect: 'none',
            }}
        >
            {heading.text}
        </div>
    );
};

/** Toolbar control: the document's headings in a menu, each jumping to its section. */
export const TableOfContentsMenu: React.FC<TableOfContentsMenuProps> = ({ value, onNavigate }) => {
    const { token } = theme.useToken();
    const [open, setOpen] = useState(false);
    const headings = useMemo(() => markdownHeadings(value), [value]);

    const pick = (line: number) => {
        setOpen(false);
        onNavigate(line);
    };

    return (
        <Dropdown
            trigger={['click']}
            open={open}
            onOpenChange={setOpen}
            disabled={headings.length === 0}
            popupRender={() => (
                <div
                    role="menu"
                    aria-label="Table of Contents"
                    style={{
                        background: token.colorBgElevated,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: token.borderRadiusLG,
                        boxShadow: token.boxShadowSecondary,
                        padding: 4,
                        minWidth: 220,
                        maxWidth: 400,
                        maxHeight: '70vh',
                        overflowY: 'auto',
                    }}
                >
                    {headings.map(heading => (
                        <HeadingRow key={heading.line} heading={heading} onPick={() => pick(heading.line)} />
                    ))}
                </div>
            )}
        >
            <Button
                aria-label="Table of Contents"
                type="text"
                size="small"
                icon={<OrderedListOutlined />}
                disabled={headings.length === 0}
                style={{ opacity: headings.length === 0 ? 0.5 : 1 }}
            />
        </Dropdown>
    );
};
