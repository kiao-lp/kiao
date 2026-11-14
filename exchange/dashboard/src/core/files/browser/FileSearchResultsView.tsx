import React, { useCallback, useEffect, useMemo } from 'react';
import { Table, type TableProps } from 'antd';
import { useCentralStack } from '../../dashboard-ui/documents/CentralStack-ctx';
import { useFileSearchContext } from '../core/FileSearch-ctx';
import { BrowserRow, searchResultToItem } from './folderBrowserRows';
import { SearchTruncatedNotice } from './SearchSnippets-cmp';
import './FileSearchResultsView.css';

export const FILE_SEARCH_RESULTS_PANEL_ID = 'file-search-results';

/** Panel on central stack over current view. Plain click navigates and clears search; modified click opens in new tab. */
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
                {/* Closed via stack cross (onClose). */}
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

/** Rendered in every view; results outlive the panel across navigation. No unmount cleanup; only cross or in-place open clears search. */
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
            // Header row is the title; no panel title.
            label: 'Search results',
            closeLabel: 'Close',
            onClose: () => clearSearch(),
            content: <FileSearchResultsBody />,
        });
        // Watch opening only; content reads results live.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return null;
};
