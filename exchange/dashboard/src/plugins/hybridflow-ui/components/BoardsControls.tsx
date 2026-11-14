import React, { useRef } from 'react';
import { Button, Switch } from 'antd';
import { PlusOutlined, ReloadOutlined, TableOutlined, UploadOutlined } from '@ant-design/icons';
import { useBoardsList } from '../BoardsList-ctx';
import styles from './BoardsList.module.css';

/** Boards list controls: archived toggle, reload, import, export, new board. */
export const BoardsControls: React.FC = () => {
    const {
        client, loading, load, showArchived, setShowArchived,
        setCreating, importFile, importing, exportArchivedCsv, exportingCsv,
    } = useBoardsList();
    const fileRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <span aria-label="Show the boards that have been put away" className={styles.when}>
                <Switch size="small" checked={showArchived} onChange={setShowArchived} /> Archived
            </span>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}
                disabled={loading || !client} aria-label="Reload the boards" />
            <Button size="small" icon={<UploadOutlined />}
                onClick={() => fileRef.current?.click()} disabled={!client} loading={importing}>
                Import
            </Button>
            { }
            <input ref={fileRef} type="file" accept=".json,application/json" hidden
                data-testid="import-board-input"
                onChange={event => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void importFile(file);
                }} />
            <Button size="small" icon={<TableOutlined />}
                onClick={() => void exportArchivedCsv()}
                disabled={!client} loading={exportingCsv}
                aria-label="Export archived flow nodes"
                data-testid="export-archived-flow-nodes" />
            <Button size="small" type="primary" icon={<PlusOutlined />}
                onClick={() => setCreating(true)} disabled={!client}>
                New board
            </Button>
        </>
    );
};
