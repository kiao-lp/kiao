import React, { DragEvent, SyntheticEvent, useCallback, useRef, useState } from 'react';
import { Button, message } from 'antd';
import { useWorkerClient } from 'kiao-worker';
import { WorkerClient } from '..';
import { useRefreshFileList } from '../../core/CurrentFileList-ctx';
import { GateMatcher, loadImportGate } from '../../../import-gate';
import { UploadTree, captureDroppedEntries, collectFromEntries, collectFromInput, uploadTree } from './folderUpload';
import { UploadReviewModal } from './UploadReviewModal';
import { UnzipChoice, UnzipModal } from './UnzipModal';
import { UploadDecisions, UploadReview, buildReview, importedZips, importSummary, planImport } from './uploadReview';

// `webkitdirectory` is missing from React types but honored by the DOM; folder-only, hence two inputs.
const directoryAttrs = {
    webkitdirectory: '',
    directory: '',
} as unknown as React.InputHTMLAttributes<HTMLInputElement>;

type Phase = { label: string; done?: number; total?: number } | null;

/** Uploads to a hidden staging area for indexing and review, not to `path`. Import moves kept files to `path`; cancel discards staging. */
export const FileUploadArea: React.FC<{ path: string }> = ({ path }) => {
    const [phase, setPhase] = useState<Phase>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [review, setReview] = useState<UploadReview | null>(null);
    const [matchers, setMatchers] = useState<GateMatcher[]>([]);
    const [importing, setImporting] = useState(false);
    const [pendingUnzip, setPendingUnzip] = useState<string[] | null>(null);
    const [unzipping, setUnzipping] = useState(false);
    const client = useWorkerClient() as WorkerClient;
    const refreshFileList = useRefreshFileList();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    const stopEvent = (e: SyntheticEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const runUpload = useCallback(async (tree: UploadTree) => {
        if (tree.items.length === 0 && tree.emptyDirs.length === 0) return;
        try {
            const staging = await client.createStaging();
            setPhase({ label: 'Uploading', done: 0, total: tree.items.length });
            const outcome = await uploadTree(client, staging.path, tree,
                (done, total) => setPhase({ label: 'Uploading', done, total }));
            setPhase({ label: 'Reading the documents…' });
            // On conversion failure, still open review with no indexes.
            // Reload the gate each upload so edits apply immediately.
            const [indexed, gate] = await Promise.all([
                client.reindex([staging.path])
                    .catch(() => ({ indexed: [], upToDate: 0, failed: [], truncated: false })),
                loadImportGate(client),
            ]);
            setMatchers(gate);
            setReview(buildReview(staging.path, path, tree, outcome, indexed));
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'The upload failed');
        } finally {
            setPhase(null);
        }
    }, [path, client]);

    const runImport = useCallback(async (decisions: UploadDecisions, redactions: Record<string, string>) => {
        if (!review) return;
        const plan = planImport(review, decisions, redactions);
        setImporting(true);
        try {
            // Apply redactions to staging copies before moving.
            for (const edit of plan.edits) await client.update(edit.path, edit.content);
            for (const folder of plan.folders) await client.createFolder(folder);
            if (plan.moves.length > 0) await client.moveBatch({ items: plan.moves });
            await client.discardStaging(review.staging);
            setReview(null);
            message.success(importSummary(review, decisions));
            const zips = importedZips(review, decisions);
            if (zips.length > 0) setPendingUnzip(zips);
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'The import failed');
        } finally {
            setImporting(false);
            refreshFileList();
        }
    }, [review, client, refreshFileList]);

    const answerUnzip = useCallback(async (choice: UnzipChoice) => {
        if (!pendingUnzip) return;
        if (choice === 'no') {
            setPendingUnzip(null);
            return;
        }
        setUnzipping(true);
        try {
            let count = 0;
            for (const zip of pendingUnzip) {
                const result = await client.unzip(zip, choice === 'yes-delete');
                count += result.extracted.length;
            }
            message.success(count === 1 ? '1 file extracted' : `${count} files extracted`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'The extraction failed');
        } finally {
            setPendingUnzip(null);
            setUnzipping(false);
            refreshFileList();
        }
    }, [pendingUnzip, client, refreshFileList]);

    const discard = useCallback(async () => {
        if (!review) return;
        setReview(null);
        await client.discardStaging(review.staging).catch(() => {
            // Silent: discard is user-requested; the next upload sweeps leftovers.
        });
    }, [review, client]);

    const onDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const entries = captureDroppedEntries(e.dataTransfer);
        const tree = entries.length > 0
            ? collectFromEntries(entries)
            : Promise.resolve(collectFromInput(Array.from(e.dataTransfer.files)));
        tree.then(runUpload).catch(error => console.error('Could not read the dropped folder', error));
    }, [runUpload]);

    const onDragOver = (e: SyntheticEvent) => {
        stopEvent(e);
        setIsDragOver(true);
    };

    const onDragLeave = (e: SyntheticEvent) => {
        stopEvent(e);
        setIsDragOver(false);
    };

    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) runUpload(collectFromInput(Array.from(e.target.files)));
        e.target.value = '';
    };

    const pickFolder = (e: React.MouseEvent) => {
        e.stopPropagation();
        folderInputRef.current?.click();
    };

    // Stable callback: the dialog reads the index in an effect keyed on it.
    const loadIndex = useCallback((indexPath: string) => client.getFileText(indexPath), [client]);

    // Dialog must be a sibling: portal events bubble through the React tree.
    // A child dialog click would reach the zone and open the picker.
    return <>
        <div className={`kiao-upload-zone${isDragOver ? ' highlight' : ''}`} onClick={() => fileInputRef.current?.click()} onDrop={onDrop} onDragEnter={onDragOver} onDragOver={onDragOver} onDragLeave={onDragLeave}>
            <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={onInputChange} onClick={(e) => e.stopPropagation()} />
            <input ref={folderInputRef} type="file" multiple {...directoryAttrs} style={{ display: 'none' }} onChange={onInputChange} onClick={(e) => e.stopPropagation()} />
            <div>Upload files, or drop a folder here</div>
            <Button type="link" size="small" onClick={pickFolder}>Upload a folder…</Button>
            {phase !== null && (
                <div data-testid="upload-progress">
                    {phase.total === undefined ? phase.label : `${phase.label} ${phase.done} / ${phase.total} files`}
                </div>
            )}
        </div>
        <UploadReviewModal
            review={review}
            matchers={matchers}
            busy={importing}
            loadIndex={loadIndex}
            onCancel={discard}
            onImport={runImport}
        />
        <UnzipModal
            zips={pendingUnzip}
            target={path}
            busy={unzipping}
            onAnswer={answerUnzip}
        />
    </>;
};
