import React, { useRef } from 'react';
import { Button, Switch } from 'antd';
import { PlusOutlined, ReloadOutlined, TableOutlined, UploadOutlined } from '@ant-design/icons';
import { Tooltip } from '@cms-core';
import { useBoardsList } from '../BoardsList-ctx';
import styles from './BoardsList.module.css';

/**
 * What the boards list is managed with: the archived switch, the reload, the import and
 * archived-cards export, and the new board. Both lists render these in their header.
 */
export const BoardsControls: React.FC = () => {
    const {
        client, loading, load, showArchived, setShowArchived,
        setCreating, importFile, importing, exportArchivedCsv, exportingCsv,
    } = useBoardsList();
    const fileRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <Tooltip title="Show the boards that have been put away">
                <span className={styles.when}>
                    <Switch size="small" checked={showArchived} onChange={setShowArchived} /> Archived
                </span>
            </Tooltip>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}
                disabled={loading || !client} aria-label="Reload the boards" />
            <Button size="small" icon={<UploadOutlined />}
                onClick={() => fileRef.current?.click()} disabled={!client} loading={importing}>
                Import
            </Button>
            {/* The file behind the Import button: shown never, reset after every pick so
                the same file can be picked twice. */}
            <input ref={fileRef} type="file" accept=".json,application/json" hidden
                data-testid="import-board-input"
                onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void importFile(file);
                }} />
            <Tooltip title="Export archived flow nodes (.csv)">
                <Button size="small" icon={<TableOutlined />}
                    onClick={() => void exportArchivedCsv()}
                    disabled={!client} loading={exportingCsv}
                    aria-label="Export archived flow nodes"
                    data-testid="export-archived-flow-nodes" />
            </Tooltip>
            <Button size="small" type="primary" icon={<PlusOutlined />}
                onClick={() => setCreating(true)} disabled={!client}>
                New board
            </Button>
        </>
    );
};
