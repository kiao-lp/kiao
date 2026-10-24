import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dropdown, MenuProps, message } from 'antd';
import { BookOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons';
import { setClipboard } from '../lib/clipboard';
import { resolveInternalLink, storedLinkOf } from '../lib/internal-links';
import { KEEP_MENU_IN_VIEWPORT } from '../files/context-menu/menuPlacement';
import { useWorkerClient } from '../files/service/ui';
import { directiveForRange } from './directiveForRange';
import { readDocumentText } from './documentText';
import { linkToPassage, TextDirective } from './textDirective';
import { addPassageToBacklog, markdownLinkToPassage } from './backlog';

/**
 * The other half of a text fragment: the reader selects a passage, right-clicks it, and takes away
 * a link that opens the document on those words.
 *
 * Chrome has an entry of its own for this, and it cannot be used. It belongs to the browser: a page
 * can neither extend it nor call it, no other browser has it, and it disappears the moment the page
 * draws a context menu of its own — which is what this is. The two are mutually exclusive, so the
 * choice is between the browser's version and one that works everywhere and can offer more.
 *
 * That choice is made per click rather than once. Only a right-click on selected text is taken
 * over; everywhere else the event is stopped before Ant Design's trigger sees it, and the browser's
 * own menu opens as it always did — which for a right-click on an image or a link is worth far
 * more than anything this could put in its place.
 */

/** What was selected, ready to be put on the clipboard or into the backlog. */
interface SelectedPassage {
    /** The passage as it reads on screen — a right-click menu must still be able to just copy. */
    text: string;
    /** The link that opens the document on it. */
    link: string;
    /** The same link as markdown in its stored form — what is pasted into a document or a note. */
    markdownLink: string;
    /** The directive the link carries — what the backlog entry quotes back. */
    directive: TextDirective;
}

/**
 * Absolute, so it works pasted into a mail or a chat. Pasted back into a Dashboard document it is
 * still recognised as internal and stripped to its bare form, fragment included — see
 * `toStoredLink` in lib/internal-links.ts.
 */
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
    /**
     * The document a copied link points at, as a store path — which is also its router path. Null
     * when the pane is showing something that is not a document of the store, where a link to a
     * passage would point nowhere.
     */
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

        /*
         * Listened for on the element itself, in the capture phase, rather than through a React
         * prop. React delivers events from the root of the app, and Ant Design's trigger calls
         * `preventDefault()` the instant it is delivered one — so declining has to happen before
         * the event ever leaves this element, and only a real capture listener is that early.
         */
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
