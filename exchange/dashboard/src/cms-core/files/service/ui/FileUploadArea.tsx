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

// webkitdirectory is absent from React's InputHTMLAttributes; the DOM still honours it. Such an
// input picks folders only, so keeping flat file picking needs the second input below.
const directoryAttrs = {
    webkitdirectory: '',
    directory: '',
} as unknown as React.InputHTMLAttributes<HTMLInputElement>;

/** What the zone is doing, when it is doing something: the sentence shown under it. */
type Phase = { label: string; done?: number; total?: number } | null;

/**
 * The upload zone of the file browser.
 *
 * What it uploads does not land in the browsed folder. It goes to a **staging area** — a directory
 * of the store no listing shows — where the documents are converted into their indexes, and only
 * then is what arrived shown, read and decided on (see {@link UploadReviewModal}). Importing is
 * what moves the files here; cancelling throws the staging area away with everything in it.
 *
 * The detour is what makes an upload reversible. A folder from a scanner, a mailbox export, a key
 * somebody handed over: the reason to upload one is that nobody knows what is in it, and until now
 * finding out meant putting all of it in the store first and sorting it out afterwards.
 *
 * The store's **import gate** is read beside the conversion and handed to the dialog, so what each
 * document says arrives with the sensitive parts of it already picked out (`cms-core/import-gate`).
 */
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
            // A conversion that fails wholesale must not lose the upload: the review still opens,
            // showing the files with no index to read rather than nothing at all. The gate is read
            // beside it, and afresh every time, so editing a category takes effect at the next
            // upload rather than at the next reload.
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

    /** Carries the decisions out: the kept files move here, and what is left goes with the area. */
    const runImport = useCallback(async (decisions: UploadDecisions, redactions: Record<string, string>) => {
        if (!review) return;
        const plan = planImport(review, decisions, redactions);
        setImporting(true);
        try {
            // The obfuscated passages go into the staging copy first, so what moves is what the
            // reviewer was last looking at and the move itself stays an ordinary move.
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

    /** Carries the unzip answer out, archive after archive. */
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

    /** Cancel: nothing is imported, and the staging area goes with everything that was in it. */
    const discard = useCallback(async () => {
        if (!review) return;
        setReview(null);
        await client.discardStaging(review.staging).catch(() => {
            // Nothing to tell the user: they asked for these files not to be kept, and the sweep
            // that runs at the next upload will finish the job.
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

    // Stable, because the dialog reads an index in an effect keyed on it: a new function every
    // render would be a new read every render.
    const loadIndex = useCallback((indexPath: string) => client.getFileText(indexPath), [client]);

    // The dialog is a sibling of the zone and not a child of it. An antd Modal renders through a
    // portal, but a portal's events still bubble up the React tree — so a click inside it would
    // reach the zone's own onClick and open the file picker over the review.
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
