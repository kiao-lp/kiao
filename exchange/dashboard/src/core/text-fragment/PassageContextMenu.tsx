import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown, MenuProps, message } from 'antd';
import { BookOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { setClipboard } from '../ui-foundation/clipboard/clipboard';
import { resolveInternalLink, storedLinkOf } from '../navigation/internal-links';
import { KEEP_MENU_IN_VIEWPORT } from '../ui-foundation/interactions/menuPlacement';
import { useWorkerClient } from '../files/service/ui';
import { directiveForRange } from './directiveForRange';
import { readDocumentText } from './documentText';
import { linkToPassage, TextDirective } from './textDirective';
import { addPassageToBacklog, markdownLinkToPassage } from './backlog';

/** Custom menu replaces the browser's (mutually exclusive). Only right-clicks on selected text are taken over; others keep the browser menu. */

interface SelectedPassage {
    /** Passage as rendered. */
    text: string;
    /** Absolute link opening the document on the passage. */
    link: string;
    /** Markdown link in stored form. */
    markdownLink: string;
    directive: TextDirective;
}

/** Absolute so it works outside Dashboard; `toStoredLink` strips it back to stored form. */
const passageLink = (path: string, directive: TextDirective): string =>
    new URL(
        resolveInternalLink(linkToPassage(storedLinkOf(path), [directive])),
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
    const hostRef = useRef<HTMLDivElement>(null);
    const [passage, setPassage] = useState<SelectedPassage | null>(null);
    const client = useWorkerClient();

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        // Capture listener on the element: React/Ant Design handling runs too late to decline.
        const onContextMenu = (event: MouseEvent) => {
            const found = path ? selectedPassage(host, path) : null;
            setPassage(found);
            if (!found) event.stopPropagation();
        };

        host.addEventListener('contextmenu', onContextMenu, true);
        return () => host.removeEventListener('contextmenu', onContextMenu, true);
    }, [path]);

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
        <Dropdown menu={{ items }} trigger={['contextMenu']} {...KEEP_MENU_IN_VIEWPORT}>
            <div ref={hostRef}>{children}</div>
        </Dropdown>
    );
};
