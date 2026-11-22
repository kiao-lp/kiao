import React from 'react';
import { Alert, Button, Spin, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useFileOptimizations } from './useFileOptimizations';
import { DuplicatesTab } from './DuplicatesTab';
import { BigFilesTab } from './BigFilesTab';
import styles from './FileOptimizations.module.css';

export const FileOptimizationsBody: React.FC = () => {
    const { result, loading, error, refresh, keepOnlyOne, deleteFiles } = useFileOptimizations(true);

    return (
        <div className={styles.view} data-testid="file-optimizations-view">
            <div className={styles.header}>
                <span className={styles.title}>File optimizations</span>
                <span className={styles.spacer} />
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()} disabled={loading}>
                    Re-scan
                </Button>
            </div>

            {error ? (
                <Alert
                    type="error"
                    showIcon
                    title="The store could not be scanned"
                    description={error}
                    action={<Button size="small" onClick={() => void refresh()}>Try again</Button>}
                />
            ) : loading && !result ? (
                <div className={styles.center}>
                    <Spin />
                    <span className={styles.scanning}>
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
