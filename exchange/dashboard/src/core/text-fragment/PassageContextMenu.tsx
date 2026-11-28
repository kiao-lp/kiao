import React, { useMemo, useState } from 'react';
import { MenuProps, message } from 'antd';
import { BookOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { setClipboard } from '../ui-foundation/clipboard/clipboard';
import { resolveInternalLink, encodedDcmsLinkOf } from '../navigation/internal-links';
import { ContextMenu, type ContextMenuPoint } from '../ui-foundation/interactions/ContextMenu';
import { useWorkerClient } from '../files/service/ui';
import { directiveForRange } from './directiveForRange';
import { readDocumentText } from './documentText';
import { linkToPassage, TextDirective } from './textDirective';
import { addPassageToBacklog, markdownLinkToPassage } from './backlog';

interface SelectedPassage {
    /** Passage as rendered. */
    text: string;
    /** Absolute link opening the document on the passage. */
    link: string;
    /** Markdown link whose destination is a DCMS link to the passage. */
    markdownLink: string;
    directive: TextDirective;
}

/** Use an absolute Dashboard URL for sharing. Pasting into Markdown converts it to a DCMS link. */
const passageLink = (path: string, directive: TextDirective): string =>
    new URL(
        resolveInternalLink(linkToPassage(encodedDcmsLinkOf(path), [directive])),
        window.location.href,
    ).toString();

const selectedPassage = (host: HTMLElement, path: string): SelectedPassage | null => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return null;

    const directive = directiveForRange(readDocumentText(host), range);
    if (!directive) return null;
    const text = range.toString();
    return {
        text,
        link: passageLink(path, directive),
        markdownLink: markdownLinkToPassage(path, directive, text),
        directive,
    };
};

const copy = async (content: string, done: string) => {
    try {
        await setClipboard(content);
        message.success(done);
    } catch {
        message.error('The clipboard is not available in this browser.');
    }
};

export interface PassageContextMenuProps {
    /** Store/router path of the open document; `null` when not a store document. */
    path: string | null;
    children: React.ReactNode;
}

export const PassageContextMenu: React.FC<PassageContextMenuProps> = ({ path, children }) => {
    const [target, setTarget] = useState<{ passage: SelectedPassage; anchor: ContextMenuPoint } | null>(null);
    const passage = target?.passage;
    const client = useWorkerClient();

    const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        const found = path ? selectedPassage(event.currentTarget, path) : null;
        if (found) event.preventDefault();
        setTarget(found ? { passage: found, anchor: { x: event.clientX, y: event.clientY } } : null);
    };

    const items = useMemo<MenuProps['items']>(() => {
        if (!passage || !path) return [];
        const addToBacklog = async () => {
            try {
                await addPassageToBacklog(client, path, passage.directive, passage.text);
            } catch {
                message.error('Could not add to the backlog.');
            }
        };
        return [
            {
                key: 'copy-text',
                icon: <CopyOutlined />,
                label: 'Copy',
                onClick: () => void copy(passage.text, 'Passage copied.'),
            },
            {
                key: 'copy-passage-link',
                icon: <LinkOutlined />,
                label: 'Copy link to this passage',
                onClick: () => void copy(passage.link, 'Link to the passage copied.'),
            },
            {
                key: 'copy-internal-markdown-link',
                icon: <LinkOutlined />,
                label: 'Copy internal markdown link',
                onClick: () => void copy(passage.markdownLink, 'Internal markdown link copied.'),
            },
            {
                key: 'add-to-backlog',
                icon: <BookOutlined />,
                label: 'Add to the backlog',
                onClick: () => void addToBacklog(),
            },
        ];
    }, [passage, path, client]);

    return (
        <>
            <div onContextMenu={onContextMenu}>{children}</div>
            <ContextMenu items={items} anchor={target?.anchor ?? null} onClose={() => setTarget(null)} />
        </>
    );
};
