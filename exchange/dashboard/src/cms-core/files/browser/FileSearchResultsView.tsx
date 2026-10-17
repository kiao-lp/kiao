import React, { useCallback, useEffect, useMemo } from 'react';
import { Table, type TableProps } from 'antd';
import { useCentralStack } from '../../core/CentralStack-ctx';
import { useFileSearchContext } from '../core/FileSearch-ctx';
import { BrowserRow, searchResultToItem } from './folderBrowserRows';
import { SearchTruncatedNotice } from './SearchSnippets-cmp';
import './FileSearchResultsView.css';

/** The search results' entry on the central area's stack. */
export const FILE_SEARCH_RESULTS_PANEL_ID = 'file-search-results';

/**
 * The file search's hits: one row per file, each with the matched lines under it.
 *
 * It is the **content of a panel on the central area's stack**
 * (`FileSearchResultsStackPanel` pushes it), over whatever the area is showing — an open
 * document, a folder listing, a board. It used to replace the folder listing instead, which is
 * what hid it behind anything that was not a folder: a search from a board navigated away to
 * show its own answers. On the stack it opens above the board like any other panel, and closing
 * it is back on what it covered.
 *
 * Opening a hit is leaving: a plain click navigates to the file and clears the search, so the
 * panel does not cover the file just opened. A modified click — Ctrl, Shift, middle button —
 * opens beside this tab instead and leaves the panel where it is.
 */
export const FileSearchResultsBody: React.FC = () => {
    const { searchResults, isSearching, searchTruncated, clearSearch } = useFileSearchContext();
    const results = searchResults ?? [];

    const onOpen = useCallback((e: React.MouseEvent) => {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) clearSearch();
    }, [clearSearch]);

    const dataSource: BrowserRow[] = useMemo(
        () => results.map(result => searchResultToItem(result, onOpen)),
        [results, onOpen],
    );

    const columns: TableProps<BrowserRow>['columns'] = useMemo(() => [{
        title: 'Name',
        dataIndex: 'label',
        key: 'label',
        render: text => text,
    }], []);

    return (
        <div className="file-search-results-view" data-testid="file-search-results-view">
            <div className="file-search-results-header">
                <span className="file-search-results-title">Search results</span>
                <span className="file-search-results-count" data-testid="file-search-results-count">
                    {results.length === 1 ? '1 file' : `${results.length} files`}
                </span>
                {/* No close of its own: the stack's floating cross dismisses the panel, through
                    `onClose` below. The row is padded past it (FileSearchResultsView.css). */}
            </div>
            {searchTruncated && <SearchTruncatedNotice shown={results.length} />}
            <div className="file-search-results-table">
                <Table
                    dataSource={dataSource}
                    columns={columns}
                    pagination={false}
                    showHeader={false}
                    size="small"
                    loading={isSearching}
                    locale={{ emptyText: isSearching ? 'Searching…' : 'No files match this search.' }}
                />
            </div>
        </div>
    );
};

/**
 * The results' panel on the central area's stack, following the search: a result list opens it
 * over whatever the area is showing, and it closes back onto that. Rendered by `LayoutContent`
 * itself, so it answers in every view — an open document, a folder, a board, the boards list.
 *
 * The results outlive the panel: navigating to another document or board brings up a new area,
 * and its follower pushes the panel again — which is why, unlike the flow node editor, this one
 * has no unmount cleanup closing it. Only the floating cross — through `onClose` — clears the
 * search, and opening a hit in place.
 */
export const FileSearchResultsStackPanel: React.FC = () => {
    const { searchResults, clearSearch } = useFileSearchContext();
    const { push, close } = useCentralStack();

    const open = searchResults !== null;

    useEffect(() => {
        if (!open) {
            close(FILE_SEARCH_RESULTS_PANEL_ID);
            return;
        }
        push({
            id: FILE_SEARCH_RESULTS_PANEL_ID,
            // No title: the view's own header row — title and count — is the header.
            label: 'Search results',
            closeLabel: 'Close',
            onClose: () => clearSearch(),
            content: <FileSearchResultsBody />,
        });
        // The content reads the results live, so only the opening is watched: a refined query
        // must not re-push the panel it answers in. `push`, `close` and `clearSearch` are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return null;
};
