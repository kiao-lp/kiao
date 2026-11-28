import React, { useRef } from 'react';
import { IconButton } from '@kiao-dashboard-core';
import { Dropdown, Switch, Tooltip } from 'antd';
import { AppstoreOutlined, FolderOutlined, PlusOutlined, ReloadOutlined, TableOutlined, UploadOutlined } from '@ant-design/icons';
import { useBoardsCatalog } from '../BoardsCatalog-ctx';
import { useBoardsList } from '../BoardsList-ctx';

export const BoardsControls: React.FC = () => {
    const { client, loading, reload, showArchived, setShowArchived } = useBoardsCatalog();
    const { openNameDialog, importFile, importing, exportArchivedCsv, exportingCsv } = useBoardsList();
    const fileRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <Tooltip title="Show archived boards">
                <Switch size="small" checked={showArchived} onChange={setShowArchived}
                    disabled={!client} aria-label="Show archived boards" />
            </Tooltip>
            <IconButton
                label="Reload the boards"
                type="default"
                icon={<ReloadOutlined />} onClick={reload}
                disabled={loading || !client} loading={loading} aria-busy={loading}
            />
            <IconButton
                label="Import board"
                tooltip
                icon={<UploadOutlined />}
                onClick={() => fileRef.current?.click()} disabled={!client} loading={importing}
            />
            <input ref={fileRef} type="file" accept=".json,application/json" hidden
                data-testid="import-board-input"
                onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void importFile(file);
                }} />
            <IconButton
                label="Export archived flow nodes"
                type="default"
                icon={<TableOutlined />}
                onClick={() => void exportArchivedCsv()}
                disabled={!client} loading={exportingCsv}
                data-testid="export-archived-flow-nodes"
            />
            <Dropdown trigger={['click']} autoFocus placement="bottomRight" disabled={!client} menu={{
                items: [
                    { key: 'board', label: 'New board', icon: <AppstoreOutlined aria-hidden="true" />,
                        onClick: () => openNameDialog({ kind: 'board' }) },
                    { key: 'folder', label: 'New folder', icon: <FolderOutlined aria-hidden="true" />,
                        onClick: () => openNameDialog({ kind: 'folder' }) },
                ],
            }}>
                <IconButton
                    label="Create board or folder"
                    tooltip
                    icon={<PlusOutlined />}
                    aria-haspopup="menu" disabled={!client}
                />
            </Dropdown>
        </>
    );
};
