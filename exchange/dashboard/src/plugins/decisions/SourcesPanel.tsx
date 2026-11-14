import React, { useEffect, useState } from 'react';
import { Button, Input, Popconfirm, Spin } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { holdsDraggedFiles, readDraggedFiles } from '@kiao-dashboard-core';
import { useDecisions } from './Decisions-ctx';
import { displayNameOf, folderNameOf } from './decisionsFile';
import styles from './Decisions.module.css';

const parentOf = (path: string): string => path.split('/').slice(0, -1).join('/');

export const SourcesPanel: React.FC = () => {
    const { sources, sourcesLoading, addSourcePaths, updateSource, removeSource, ensureLoaded, reload } = useDecisions();
    const [dropping, setDropping] = useState(false);
    const [draft, setDraft] = useState('');

    useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

    const addDraft = () => {
        const path = draft.trim().replace(/\/+$/, '');
        if (!path) return;
        addSourcePaths([path]);
        setDraft('');
    };

    return (
        <div
            className={`${styles.sources} ${dropping ? styles.dropActive : ''}`}
            data-testid="decision-sources-panel"
            onDragOver={event => {
                if (!holdsDraggedFiles(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={event => {
                setDropping(false);
                const files = readDraggedFiles(event.dataTransfer);
                if (!files.length) return;
                event.preventDefault();
                event.stopPropagation();
                addSourcePaths(files.map(file => (file.isDirectory ? file.path : parentOf(file.path))).filter(Boolean));
            }}
        >
            <div className={styles.hint}>
                Folders holding decision files. Drop a folder from the file tree, or type its path.
                The list lives in <code>kiao-user-config/decisions.json</code>.
            </div>
            {sourcesLoading && sources.length === 0 && <div className={styles.center}><Spin /></div>}
            {sources.map((source, index) => (
                <div key={index} className={styles.sourceRow} data-testid="decision-source">
                    <div className={styles.sourceFields}>
                        <label>
                            <span className={styles.fieldName}>Path</span>
                            <Input
                                size="small"
                                value={source.path}
                                aria-label="Source path"
                                data-testid="source-path"
                                onChange={event => updateSource(index, { path: event.target.value })}
                            />
                        </label>
                        <label>
                            <span className={styles.fieldName}>Name</span>
                            <Input
                                size="small"
                                value={source.name}
                                placeholder={folderNameOf(source.path)}
                                aria-label="Source name"
                                data-testid="source-name"
                                onChange={event => updateSource(index, { name: event.target.value })}
                            />
                        </label>
                        <span className={styles.fieldName}>Shown as: {displayNameOf(source)}</span>
                    </div>
                    <Popconfirm
                        title="Delete this source?"
                        description="Its decisions leave the table. The folder stays in the store."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        cancelText="Cancel"
                        onConfirm={() => removeSource(index)}
                    >
                        <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label={`Delete source ${displayNameOf(source)}`}
                            data-testid="delete-source"
                        />
                    </Popconfirm>
                </div>
            ))}
            <div className={styles.sourceRow}>
                <div className={styles.sourceFields}>
                    <label>
                        <span className={styles.fieldName}>New source path</span>
                        <Input
                            size="small"
                            value={draft}
                            placeholder="docs/solution-design/decisions"
                            aria-label="New source path"
                            data-testid="new-source-path"
                            onChange={event => setDraft(event.target.value)}
                            onPressEnter={addDraft}
                        />
                    </label>
                </div>
                <Button size="small" icon={<PlusOutlined />} data-testid="add-source" onClick={addDraft}>
                    Add
                </Button>
                <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined spin={sourcesLoading} />}
                    aria-label="Read the file again"
                    onClick={reload}
                />
            </div>
        </div>
    );
};
