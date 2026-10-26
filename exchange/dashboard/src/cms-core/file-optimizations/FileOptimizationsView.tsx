import React, { useEffect } from 'react';
import { Alert, Button, Spin, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useCentralStack } from '../core/CentralStack-ctx';
import { useFileOptimizationsView, useFileOptimizationsViewOptional } from './FileOptimizations-ctx';
import { useFileOptimizations } from './useFileOptimizations';
import { DuplicatesTab } from './DuplicatesTab';
import { BigFilesTab } from './BigFilesTab';
import styles from './FileOptimizations.module.css';

/** The view's entry on the central area's stack. */
export const FILE_OPTIMIZATIONS_PANEL_ID = 'file-optimizations';

/**
 * What the store is carrying that it need not be, in two tabs: the files stored more than once, and
 * the biggest ones.
 *
 * It is the **content of a panel on the central area's stack** (`FileOptimizationsStackPanel`
 * pushes it), over whatever the area is showing — an open document, a board. An application mode
 * rather than a tool bar tab, for the reason given in `FileOptimizations-ctx`: it is about the
 * store rather than the open document, and what it draws is two wide tables.
 */
export const FileOptimizationsBody: React.FC = () => {
    const { open } = useFileOptimizationsView();
    const { result, loading, error, refresh, keepOnlyOne, deleteFiles } = useFileOptimizations(open);

    return (
        <div className={styles.view} data-testid="file-optimizations-view">
            <div className={styles.header}>
                <span className={styles.title}>File optimizations</span>
                <span className={styles.spacer} />
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()} disabled={loading}>
                    Re-scan
                </Button>
                {/* No close of its own: the stack's floating cross dismisses the panel, through
                    `onClose` below. The row is padded past it (FileOptimizations.module.css). */}
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

/**
 * The view's panel on the central area's stack, following the flag the tools menu switches:
 * up over whatever the area is showing, and closing back onto that. Rendered by `LayoutContent`
 * itself, so it answers in every view — an open document, a board, the boards list.
 *
 * The flag outlives the panel: navigating to another document or board brings up a new area, and
 * its follower pushes the panel again — which is why this one has no unmount cleanup closing it.
 * Only the floating cross — through `onClose` — switches the flag off.
 */
export const FileOptimizationsStackPanel: React.FC = () => {
    const optimizations = useFileOptimizationsViewOptional();
    const { push, close } = useCentralStack();

    const open = optimizations?.open ?? false;
    const hide = optimizations?.hide;

    useEffect(() => {
        if (!open || !hide) {
            close(FILE_OPTIMIZATIONS_PANEL_ID);
            return;
        }
        push({
            id: FILE_OPTIMIZATIONS_PANEL_ID,
            // No title: the view's own header row — title and Re-scan — is the header.
            label: 'File optimizations',
            closeLabel: 'Close',
            onClose: () => hide(),
            content: <FileOptimizationsBody />,
        });
        // Only the flag is watched: a re-scan must not re-push the panel it answers in. `push`,
        // `close` and `hide` are stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    return null;
};
