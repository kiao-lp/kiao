import React from 'react';
import { Alert, Button, Spin, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { InProgressFeedback } from '@kiao-dashboard-core';
import { useFileOptimizations } from './useFileOptimizations';
import { DuplicatesTab } from './DuplicatesTab';
import { BigFilesTab } from './BigFilesTab';
import styles from './FileOptimizations.module.css';

const operationLabels = { scan: 'Scanning files…', consolidate: 'Consolidating duplicates…', delete: 'Deleting selected files…' };

export const FileOptimizationsBody: React.FC = () => {
    const { result, operation, error, refresh, keepOnlyOne, deleteFiles } = useFileOptimizations(true);
    const scanning = operation === 'scan';
    const busy = operation !== null;

    return (
        <div className={styles.view} data-testid="file-optimizations-view">
            <div className={styles.header}>
                <span className={styles.title}>File optimizations</span>
                <span className={styles.spacer} />
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()} disabled={busy}
                    loading={scanning} aria-label="Re-scan" aria-busy={scanning}>
                    Re-scan
                </Button>
            </div>
            {operation && result && <InProgressFeedback label={operationLabels[operation]} />}

            {error ? (
                <Alert
                    type="error"
                    showIcon
                    title="The store could not be scanned"
                    description={error}
                    action={<Button size="small" disabled={busy} loading={scanning} onClick={() => void refresh()}>Try again</Button>}
                />
            ) : scanning && !result ? (
                <div className={styles.center}>
                    <Spin />
                    <span className={styles.scanning} role="status">
                        Reading the store — the files that share a size are read in full.
                    </span>
                </div>
            ) : result ? (
                <Tabs
                    className={styles.tabs}
                    defaultActiveKey="duplicates"
                    items={[
                        {
                            key: 'duplicates',
                            label: `Duplicates${result.duplicates.length ? ` (${result.duplicates.length})` : ''}`,
                            children: (
                                <DuplicatesTab
                                    duplicates={result.duplicates}
                                    scanned={result.scanned}
                                    truncated={result.truncated}
                                    blocked={busy}
                                    keepOnlyOne={keepOnlyOne}
                                />
                            ),
                        },
                        {
                            key: 'big-files',
                            label: 'Big files',
                            children: (
                                <BigFilesTab
                                    largest={result.largest}
                                    scanned={result.scanned}
                                    truncated={result.truncated}
                                    blocked={busy}
                                    deleteFiles={deleteFiles}
                                />
                            ),
                        },
                    ]}
                />
            ) : null}
        </div>
    );
};
