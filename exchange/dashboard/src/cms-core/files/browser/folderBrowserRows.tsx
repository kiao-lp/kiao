import React from 'react';
import { Tag } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { Pointable } from 'react-advanced-interactions';
import { SearchResult, FileDto } from 'src/cms-core/files/service';
import { FileLabelSwitch } from '../core/FileLabelSwitch-cmp';
import { SilentLink } from '../core/SilentLink-cmp';
import { SearchSnippets } from './SearchSnippets-cmp';

/** A single row in the folder table — either a file, a search hit, or the ".." up row. */
export interface BrowserRow {
    key: string;
    label: React.ReactNode;
    value: string;
    file?: FileDto;
    isSearchResult?: boolean;
    isUpRow?: boolean;
}

export const fileToItem = (file: FileDto): BrowserRow => ({
    key: file.path,
    value: file.path,
    label: (
        <Pointable id={file.path}>
            <div style={{ color: 'inherit', display: 'block' }} data-testid={`browser-item-${file.path}`}>
                <FileLabelSwitch file={file} />
            </div>
        </Pointable>
    ),
    file: file
});

export const searchResultToItem = (
    result: SearchResult,
    onOpen?: (e: React.MouseEvent) => void,
): BrowserRow => {
    const parts = result.file.split('/');
    const fileName = parts.pop() || result.file;
    return {
        key: result.file,
        value: result.file,
        label: (
            <SilentLink
                to={result.file}
                style={{ color: 'inherit', display: 'block', width: '100%' }}
                onClick={onOpen}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>
                        <FileTextOutlined style={{ marginRight: 8 }} />
                        {fileName}
                        <span style={{ opacity: 0.5, marginLeft: 8, fontSize: '0.8em' }}>{parts.join('/')}</span>
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>

                        {result.matches.length > 0 && <Tag>{result.matches.length}</Tag>}
                    </div>
                </div>
                <SearchSnippets matches={result.matches} />
            </SilentLink>
        ),
        isSearchResult: true
    };
};
