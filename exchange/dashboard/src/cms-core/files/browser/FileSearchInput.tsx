import React, { useEffect, useState } from 'react';
import { theme } from 'antd';
import { Tooltip } from '../../ui-foundation/feedback/Tooltip';
import { VoiceInput } from '../../ui-foundation/voice-input';
import { SearchOutlined, QuestionCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';

export type FileSearchInputProps = {
    onSearch: (query: string) => void;
    onClear: () => void;
    /** What the server refused about the last query — an uncompilable /regex/, or an all-negative query. */
    error?: string | null;
    /** Whether a result list is on screen. When it goes away, the query goes with it. */
    showingResults?: boolean;
};

// Query language: `searchquery.go` and `PROTOCOL.md`. No i18n; copy is a literal.
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

    // Clear query when results close; refused queries stay.
    useEffect(() => {
        if (!showingResults) setQuery('');
    }, [showingResults]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        if (!e.target.value.trim()) onClear();
    };

    // Enter only: partial quoted/regex queries must not fire.
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
