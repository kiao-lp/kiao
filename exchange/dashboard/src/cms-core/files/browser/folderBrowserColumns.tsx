import React from 'react';
import { Dropdown, Button, MenuProps } from 'antd';
import type { TableProps } from 'antd';
import { DownloadOutlined, SwapOutlined, EllipsisOutlined, CopyOutlined } from '@ant-design/icons';
import type { BrowserRow } from './folderBrowserRows';

const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

const formatModified = (lastModified: number): string => {
    const date = new Date(lastModified);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isThisYear = date.getFullYear() === now.getFullYear();

    if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (isThisYear) {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

export interface FolderColumnActions {
    onDownload: (path: string) => void;
    onReplace: (path: string) => void;
    onDuplicate: (path: string) => void;
}

/** The folder table's columns: name, size, item count, modified date and a per-row action menu. */
export const buildFolderBrowserColumns = (
    { onDownload, onReplace, onDuplicate }: FolderColumnActions,
): TableProps<BrowserRow>['columns'] => [
    {
        title: 'Name',
        dataIndex: 'label',
        key: 'label',
        render: (text) => text,
    },
    {
        title: 'Size',
        key: 'size',
        width: 100,
        responsive: ['md'],
        render: (_, record) => {
            if (record.isUpRow || !record.file) return null;
            if (record.file.isDirectory) return null;
            if (record.file.size === undefined) return null;
            return <span style={{ opacity: 0.7, fontSize: '0.9em' }}>{formatSize(record.file.size)}</span>;
        }
    },
    {
        title: 'Items',
        key: 'items',
        width: 70,
        responsive: ['md'],
        render: (_, record) => {
            if (record.isUpRow || !record.file) return null;
            if (!record.file.isDirectory) return null;
            if (record.file.childrenCount === undefined || record.file.childrenCount === null) return null;
            return <span style={{ opacity: 0.7, fontSize: '0.9em' }}>{record.file.childrenCount}</span>;
        }
    },
    {
        title: 'Modified',
        key: 'modified',
        width: 150,
        responsive: ['md'],
        render: (_, record) => {
            if (record.isUpRow || !record.file) return null;
            if (record.file.lastModified === undefined) return null;
            return <span style={{ opacity: 0.7, fontSize: '0.9em' }}>{formatModified(record.file.lastModified)}</span>;
        }
    },
    {
        title: 'Actions',
        key: 'actions',
        width: 50,
        render: (_, record) => {
            if (record.isUpRow) return null;

            const path = record.value;
            const isDirectory = record.file?.isDirectory;

            const items: MenuProps['items'] = [
                {
                    key: 'duplicate',
                    label: 'Duplicate',
                    icon: <CopyOutlined />,
                    onClick: (e) => {
                        e.domEvent.stopPropagation();
                        onDuplicate(path);
                    }
                },
                {
                    key: 'download',
                    label: 'Download',
                    icon: <DownloadOutlined />,
                    onClick: (e) => {
                        e.domEvent.stopPropagation();
                        onDownload(path);
                    }
                }
            ];

            if (isDirectory === false || (isDirectory === undefined && !record.isSearchResult)) {
                items.push({
                    key: 'replace',
                    label: 'Replace',
                    icon: <SwapOutlined />,
                    onClick: (e) => {
                        e.domEvent.stopPropagation();
                        onReplace(path);
                    }
                });
            }

            return (
                <div onClick={e => e.stopPropagation()} data-row-action>
                    <Dropdown menu={{ items }} trigger={['click']}>
                        <Button type="text" icon={<EllipsisOutlined />} size="small" />
                    </Dropdown>
                </div>
            );
        }
    }
];
