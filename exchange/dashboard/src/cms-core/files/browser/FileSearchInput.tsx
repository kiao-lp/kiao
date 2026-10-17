import React, { useEffect, useState } from 'react';
import { theme } from 'antd';
import { Tooltip } from '../../ui/Tooltip';
import { VoiceInput } from '../../ui/VoiceInput';
import { SearchOutlined, QuestionCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';

export type FileSearchInputProps = {
    onSearch: (query: string) => void;
    onClear: () => void;
    /** What the server refused about the last query — an uncompilable /regex/, or an all-negative query. */
    error?: string | null;
    /** Whether a result list is on screen. When it goes away, the query goes with it. */
    showingResults?: boolean;
};

// The query language lives in worker (searchquery.go, and PROTOCOL.md for the prose); this is
// its user-facing summary. Dashboard has no i18n framework, so the copy is a plain English literal.
export const SYNTAX_HELP = (
    <div>
        <p style={{ margin: '0 0 4px' }}><b>All match one file</b> — name or content.</p>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li><code>plan budget</code> — words, any case</li>
            <li><code>&quot;Plan Budget&quot;</code> — exact text, exact case</li>
            <li><code>/bud\w+/i</code> — regex, /i ignores case</li>
            <li><code>-draft</code> — exclude</li>
        </ul>
    </div>
);

export const FileSearchInput: React.FC<FileSearchInputProps> = ({ onSearch, onClear, error, showingResults }) => {
    const { token } = theme.useToken();
    const [query, setQuery] = useState('');

    // Results dismissed from elsewhere — the panel's floating cross — empty the box as well: a query
    // still written with no result panel up reads as a search that found nothing. Only the
    // transition does it, so typing before a first search, and a refused query, are left alone.
    useEffect(() => {
        if (!showingResults) setQuery('');
    }, [showingResults]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        if (!e.target.value.trim()) onClear();
    };

    // Enter only, no search-as-you-type: with quotes and slashes in the grammar, every intermediate
    // keystroke would fire a query the user has not finished writing.
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== 'Enter') return;
        if (query.trim()) onSearch(query); else onClear();
    };

    return (
        <VoiceInput
            placeholder="Search"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            size="small"
            status={error ? 'error' : undefined}
            prefix={<SearchOutlined style={{ color: token.colorTextDescription }} />}
            // VoiceInput nests this suffix to the LEFT of its microphone, so the row reads [?] [mic].
            suffix={
                error ? (
                    <Tooltip title={error}>
                        <ExclamationCircleOutlined
                            data-testid="search-error-icon"
                            style={{ color: token.colorError, cursor: 'help' }}
                        />
                    </Tooltip>
                ) : (
                    <Tooltip title={SYNTAX_HELP} styles={{ root: { maxWidth: 440 } }}>
                        <QuestionCircleOutlined
                            data-testid="search-help-icon"
                            style={{ color: token.colorTextDescription, cursor: 'help' }}
                        />
                    </Tooltip>
                )
            }
            allowClear
        />
    );
};
