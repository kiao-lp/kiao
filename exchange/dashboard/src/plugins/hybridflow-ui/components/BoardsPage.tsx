import React from 'react';
import { LayoutContent, TopBanner } from '@cms-core';
import { BoardsList } from './BoardsList';

/**
 * The boards as a central page, at `/boards` — the address a bookmark, a pasted link or a second
 * tab still opens. The `...` menu opens the same list as a lateral panel instead, so the document
 * stays where it is; this page is what a bare `/boards` URL answers with.
 *
 * The top banner is drawn with it, as every view does: the menu that lists the boards is in the
 * banner, and a page with no way back to its own switch is one people reload out of.
 */
export const BoardsPage: React.FC = () => (
    <>
        <LayoutContent>
            <BoardsList />
        </LayoutContent>
        <TopBanner />
    </>
);
