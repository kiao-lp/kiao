import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Modal, Progress, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined } from '@ant-design/icons';
import type { FileDto } from 'kiao-worker';
import { Tooltip } from '../ui/Tooltip';
import { useNavigation } from '../files/navigation/NavigationModel';
import { folderLabel, folderOf, formatSize, nameOf } from './duplicatesModel';
import styles from './FileOptimizations.module.css';

/**
 * A file with its place in the list. The rank is carried rather than taken from the render index:
 * the table paginates, and an index is the row's place on *its page* — which restarts at one.
 */
interface BigFileRow extends FileDto {
    rank: number;
}

const filesWord = (n: number): string => n === 1 ? 'file' : 'files';

const bytesOf = (files: FileDto[]): number => files.reduce((sum, f) => sum + f.size, 0);

export interface BigFilesTabProps {
    largest: FileDto[];
    scanned: number;
    truncated: boolean;
    deleteFiles: (paths: string[]) => Promise<void>;
}

/**
 * The biggest files of the store, biggest first.
 *
 * Its first job is to *say which files they are*, which is the part nobody can get at otherwise. A
 * bar per row against the largest gives the shape of the tail at a glance: a store whose top ten are
 * all the same size has a different problem from one with a single outlier.
 *
 * The one answer it offers is deletion, and only of what was ticked. What to do about a 400 MB video
 * is not a question with one answer — move it out, re-encode it, leave it — so nothing is ticked for
 * the reader and the button reaches no further than their ticks. But the answer it most often has is
 * *that is a leftover*, and a list of the ten files to let go of wants one press rather than ten trips
 * through the file browser.
 */
export const BigFilesTab: React.FC<BigFilesTabProps> = ({ largest, scanned, truncated, deleteFiles }) => {
    const nav = useNavigation();
    const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
    const [busy, setBusy] = useState(false);
    const biggest = largest[0]?.size ?? 0;
    const rows: BigFileRow[] = useMemo(
        () => largest.map((file, index) => ({ ...file, rank: index + 1 })),
        [largest],
    );

    // Only what is still listed. The re-scan after a delete drops the rows that went, and a ticked
    // path that is no longer on screen would be a button reaching a file the reader cannot see.
    const selected = useMemo(() => largest.filter(f => picked.has(f.path)), [largest, picked]);
    const every = selected.length > 0 && selected.length === largest.length;

    const tick = useCallback((path: string, on: boolean) => setPicked(prev => {
        const next = new Set(prev);
        if (on) next.add(path); else next.delete(path);
        return next;
    }), []);

    const run = useCallback(async (files: FileDto[]) => {
        setBusy(true);
        try {
            await deleteFiles(files.map(f => f.path));
            message.success(`${files.length} ${filesWord(files.length)} deleted — ${formatSize(bytesOf(files))} given back`);
            setPicked(new Set());
        } catch (e: any) {
            // The ticks are kept: what did go has left the list with the re-scan, so what is still
            // ticked is exactly what did not, ready to be looked at or tried again.
            message.error(e?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    }, [deleteFiles]);

    const confirm = useCallback((files: FileDto[]) => {
        Modal.confirm({
            title: files.length === 1 ? 'Delete this file?' : `Delete these ${files.length} files?`,
            width: 560,
            content: (
                <div className={styles.confirm}>
                    <p>
                        <strong>{formatSize(bytesOf(files))}</strong> given back. These paths stop naming a file:
                    </p>
                    <div className={styles.planList}>
                        <ul>
                            {files.map(f => (
                                <li key={f.path}>/{f.path} <span className={styles.dim}>{formatSize(f.size)}</span></li>
                            ))}
                        </ul>
                    </div>
                    {/* Unlike a consolidation, nothing stays behind that holds these bytes: said here,
                        before, rather than discovered after. */}
                    <p className={styles.dim}>Unlike keeping one of a duplicate, no copy of these remains.</p>
                </div>
            ),
            okText: 'Delete all',
            okButtonProps: { danger: true },
            onOk: () => run(files),
        });
    }, [run]);

    const columns: ColumnsType<BigFileRow> = [
        {
            // Every file listed, not every file on the page: the list is the scan's answer and is
            // short enough to be read whole, and a "select all" that stopped at row 25 would leave the
            // reader to find out which of their ticks the button was not going to reach.
            title: (
                <Checkbox
                    checked={every}
                    indeterminate={selected.length > 0 && !every}
                    disabled={busy}
                    onChange={e => setPicked(e.target.checked ? new Set(largest.map(f => f.path)) : new Set())}
                    aria-label="Select every file listed"
                />
            ),
            key: 'select',
            width: 44,
            align: 'center',
            render: (_: unknown, file) => (
                <Checkbox
                    checked={picked.has(file.path)}
                    disabled={busy}
                    onChange={e => tick(file.path, e.target.checked)}
                    aria-label={`Select ${file.path}`}
                />
            ),
        },
        {
            title: '#',
            dataIndex: 'rank',
            width: 56,
            render: (_: unknown, file) => <span className={styles.dim}>{file.rank}</span>,
        },
        {
            title: 'Size',
            dataIndex: 'size',
            width: 110,
            align: 'right',
            render: (_: unknown, file) => <strong>{formatSize(file.size)}</strong>,
        },
        {
            title: 'Share of the biggest',
            key: 'share',
            width: 170,
            render: (_: unknown, file) => (
                <Progress
                    percent={biggest > 0 ? Math.round((file.size / biggest) * 100) : 0}
                    size="small"
                    showInfo={false}
                />
            ),
        },
        {
            title: 'File',
            key: 'file',
            render: (_: unknown, file) => (
                <Tooltip title="Open in a new tab">
                    <a onClick={() => nav.openInNewTab(file.path)}>{nameOf(file.path)}</a>
                </Tooltip>
            ),
        },
        {
            title: 'Folder',
            key: 'folder',
            render: (_: unknown, file) => (
                <span className={styles.path}>{folderLabel(folderOf(file.path))}</span>
            ),
        },
        {
            title: 'Modified',
            dataIndex: 'lastModified',
            width: 170,
            render: (_: unknown, file) => (
                <span className={styles.dim}>{new Date(file.lastModified).toLocaleString()}</span>
            ),
        },
    ];

    if (largest.length === 0) {
        return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="The scan found no file to weigh." />;
    }

    return (
        <div className={styles.tab} data-testid="big-files-tab">
            <div className={styles.tabHead}>
                <span>
                    The <strong>{largest.length}</strong> biggest of {scanned} files read.
                </span>
                <span className={styles.spacer} />
                {/* What the press reaches, before it is pressed. */}
                <span data-testid="delete-summary">
                    {selected.length === 0
                        ? 'No file selected'
                        : `${selected.length} ${filesWord(selected.length)} selected — ${formatSize(bytesOf(selected))}`}
                </span>
                <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    disabled={selected.length === 0 || busy}
                    loading={busy}
                    onClick={() => confirm(selected)}
                >
                    Delete all
                </Button>
            </div>
            {truncated && (
                <Alert
                    type="info"
                    showIcon
                    title="There is more than this shows"
                    description="The scan stopped at its cap, or at a folder the store declares is not content."
                />
            )}
            <Table<BigFileRow>
                size="small"
                rowKey="path"
                columns={columns}
                dataSource={rows}
                pagination={{ pageSize: 25, hideOnSinglePage: true }}
            />
        </div>
    );
};
