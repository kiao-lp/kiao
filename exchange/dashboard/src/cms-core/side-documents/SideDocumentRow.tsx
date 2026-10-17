import React, { ReactNode } from 'react';
import { SplitPart, SplitRow } from '../split';
import { useSideDocuments } from './SideDocuments-ctx';

export type SideDocumentRowProps = {
    /** The host plugin's own editor or viewer. */
    children: ReactNode;
    /**
     * The host has nothing of its own on screen — both markdown panes switched off, say. It then
     * gives its width up to the side documents rather than holding an empty half of the window;
     * with no side document open it keeps it, since collapsing would leave nothing at all.
     */
    hostHidden?: boolean;
};

/**
 * The row a document is drawn in once it may be shown with documents of other plugins beside it:
 * the host's own view, then one pane per side document the reader has switched on, left to right,
 * each of them dragged as wide as the reader wants it (see `split/`).
 *
 * This is the slot half of the side-document contract. A plugin becomes a host by wrapping its
 * editor in this and putting `<SideDocumentToggles/>` in its tool bar — it names no side document
 * and imports no plugin, so it accepts the ones that exist and the ones that do not exist yet.
 */
export const SideDocumentRow: React.FC<SideDocumentRowProps> = ({ children, hostHidden }) => {
    const { opened } = useSideDocuments();

    if (opened.length === 0) {
        return <>{children}</>;
    }

    const parts: SplitPart[] = [
        { name: 'host', className: 'cms-side-document-host', collapsed: hostHidden, children },
        ...opened.map(({ declaration, context }) => ({
            name: declaration.id,
            className: 'cms-side-document',
            'data-side-document': declaration.id,
            children: declaration.render(context),
        })),
    ];

    return <SplitRow id="sideDocuments" className="cms-side-document-row" parts={parts} />;
};
