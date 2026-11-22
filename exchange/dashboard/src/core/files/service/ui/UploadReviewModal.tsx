import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Radio, Tree } from 'antd';
import type { TreeDataNode } from 'antd';
import { FileTextOutlined, WarningOutlined } from '@ant-design/icons';
import { GateMatcher, GatedTextView } from '../../../import-gate';
import { ConfiguredMarkdown } from '../../../markdown/ConfiguredMarkdown';
import { Tooltip } from '../../../ui-foundation/feedback/Tooltip';
import {
    ReviewNode,
    UploadDecision,
    UploadDecisions,
    UploadReview,
    isFullyDecided,
    reviewTree,
    reviewableFiles,
    textImportName,
} from './uploadReview';
import styles from './UploadReviewModal.module.css';

/** One array, so a dialog opened on a store with no gate does not re-scan on every render. */
const NO_MATCHERS: GateMatcher[] = [];

// Module scope: a new function per render would recreate the document.
const renderMarkdown = (text: string) => <ConfiguredMarkdown revealLinkTargets={false}>{text}</ConfiguredMarkdown>;

export interface UploadReviewModalProps {
    /** Upload under review, or null. */
    review: UploadReview | null;
    /** Reads a staging file as text. */
    loadIndex: (path: string) => Promise<string>;
    /** Cancels; nothing is imported. */
    onCancel: () => void;
    /** Imports kept files, deletes the rest, writes redactions. Paths are staging-relative. */
    onImport: (decisions: UploadDecisions, redactions: Record<string, string>) => void;
    /** True while import runs. */
    busy?: boolean;
    /** Import-gate matchers. Empty when no gate is configured. */
    matchers?: GateMatcher[];
}

/** Review dialog for a staged upload before import. Not dismissible by Escape or outside click; every exit is an explicit action. */
export const UploadReviewModal: React.FC<UploadReviewModalProps> = ({
    review, loadIndex, onCancel, onImport, busy, matchers,
}) => {
    const [decisions, setDecisions] = useState<UploadDecisions>({});
    const [selected, setSelected] = useState<string | null>(null);
    const [indexText, setIndexText] = useState<string | null>(null);
    // Redacted texts by staging-relative path; must outlive file selection.
    const [redactions, setRedactions] = useState<Record<string, string>>({});
    // Which import button was pressed, for its spinner.
    const [pressed, setPressed] = useState<'safe' | 'unsafe' | null>(null);

    // A new upload is a new review: the previous one's answers must not carry over into it.
    useEffect(() => {
        setDecisions({});
        setSelected(null);
        setIndexText(null);
        setRedactions({});
        setPressed(null);
    }, [review?.staging]);

    const file = review?.files.find(f => f.relativePath === selected) ?? null;
    const textPath = file?.textPath ?? '';

    // Show redacted text, not the staging copy, so shown text matches imported text.
    useEffect(() => {
        if (!review || !textPath) {
            setIndexText(null);
            return;
        }
        const edited = redactions[textPath];
        if (edited !== undefined) {
            setIndexText(edited);
            return;
        }
        let current = true;
        setIndexText(null);
        loadIndex(`${review.staging}/${textPath}`)
            .then(text => { if (current) setIndexText(text); })
            .catch(() => { if (current) setIndexText('The text could not be read.'); });
        return () => { current = false; };
        // `redactions` is excluded: redact already sets shown text; re-running would race it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [review, textPath, loadIndex]);

    const redact = useCallback((next: string) => {
        if (!textPath) return;
        setIndexText(next);
        setRedactions(previous => ({ ...previous, [textPath]: next }));
    }, [textPath]);

    const decide = useCallback((path: string, decision: UploadDecision) => {
        setDecisions(previous => ({ ...previous, [path]: decision }));
    }, []);

    const nodes = useMemo<TreeDataNode[]>(
        () => (review ? toTreeData(reviewTree(review), decisions) : []),
        [review, decisions]);

    if (!review) return null;

    const reviewable = reviewableFiles(review);
    const decided = reviewable.filter(f => decisions[f.relativePath] !== undefined).length;
    const complete = isFullyDecided(review, decisions);

    return (
        <Modal
            open
            title={`Uploaded to ${review.target || 'the store'} — ${review.files.length} file${review.files.length === 1 ? '' : 's'}`}
            width="80vw"
            style={{ top: 24 }}
            styles={{ body: { height: '68vh', display: 'flex', flexDirection: 'column', gap: 12 } }}
            maskClosable={false}
            keyboard={false}
            onCancel={onCancel}
            destroyOnHidden
            footer={[
                <Button key="cancel" onClick={onCancel} disabled={busy} data-testid="upload-review-cancel">
                    Cancel
                </Button>,
                <Button
                    key="unsafe"
                    type="primary"
                    danger
                    icon={<WarningOutlined />}
                    loading={busy && pressed === 'unsafe'}
                    disabled={busy}
                    onClick={() => { setPressed('unsafe'); onImport(decisions, redactions); }}
                    data-testid="upload-review-unsafe"
                >
                    Unsafe import
                </Button>,
                <Button
                    key="safe"
                    type="primary"
                    disabled={!complete || busy}
                    loading={busy && pressed === 'safe'}
                    onClick={() => { setPressed('safe'); onImport(decisions, redactions); }}
                    data-testid="upload-review-safe"
                >
                    Safe import
                </Button>,
            ]}
        >
            {review.failed.length > 0 && (
                <Alert
                    type="error"
                    showIcon
                    message={`${review.failed.length} file${review.failed.length === 1 ? '' : 's'} could not be uploaded`}
                    description={review.failed.slice(0, 5).join(', ')}
                />
            )}
            {review.truncated && (
                <Alert
                    type="warning"
                    showIcon
                    message="The conversion stopped at the server's limit, so some documents here have no index to read."
                />
            )}
            <div className={styles.body}>
                <div className={styles.tree} data-testid="upload-review-tree">
                    <Tree
                        treeData={nodes}
                        defaultExpandAll
                        selectedKeys={selected ? [selected] : []}
                        onSelect={keys => setSelected(keys.length > 0 ? String(keys[0]) : null)}
                    />
                </div>
                <div className={styles.reader}>
                    <div className={styles.choice}>
                        <span className={styles.selectedPath} data-testid="upload-review-selected">
                            {file ? file.relativePath : 'Select a file'}
                        </span>
                        <Radio.Group
                            value={file ? decisions[file.relativePath] : undefined}
                            disabled={!file || busy}
                            onChange={e => file && decide(file.relativePath, e.target.value as UploadDecision)}
                        >
                            <Radio value="delete" data-testid="upload-review-delete">Delete</Radio>
                            <Radio value="import" data-testid="upload-review-import">Import</Radio>
                            {/* Only with an index: no text exists to import otherwise. */}
                            <Tooltip
                                title={file?.indexPath
                                    ? `Imports ${textImportName(file.indexPath).split('/').pop()} instead, and drops the original`
                                    : 'This file was not converted, so there is no text to import in its place'}
                            >
                                <Radio
                                    value="text"
                                    disabled={!file?.indexPath}
                                    data-testid="upload-review-as-text"
                                >
                                    Import as text
                                </Radio>
                            </Tooltip>
                        </Radio.Group>
                    </div>
                    {file?.textPath
                        ? <GatedTextView
                            text={indexText ?? 'Reading…'}
                            matchers={matchers ?? NO_MATCHERS}
                            renderRich={file.isMarkdown && indexText !== null ? renderMarkdown : undefined}
                            onTextChange={busy ? undefined : redact}
                            resetKey={file.textPath}
                            testId="upload-review-index"
                        />
                        : <div className={`${styles.index} ${styles.empty}`} data-testid="upload-review-index">
                            {file
                                ? 'This file is not text and could not be converted, so there is nothing to read here. It is imported unless you mark it for deletion.'
                                : 'Pick a file in the tree to read what it says.'}
                        </div>}
                    <div data-testid="upload-review-progress">
                        {reviewable.length === 0
                            ? 'Nothing here could be read, so Safe import is ready.'
                            : `${decided} of ${reviewable.length} readable document${reviewable.length === 1 ? '' : 's'} decided`}
                    </div>
                </div>
            </div>
        </Modal>
    );
};

const decisionStyle: Record<UploadDecision, string> = {
    import: styles.import,
    delete: styles.delete,
    text: styles.asText,
};

const toTreeData = (nodes: ReviewNode[], decisions: UploadDecisions): TreeDataNode[] =>
    nodes.map(node => {
        const decision = node.file ? decisions[node.file.relativePath] : undefined;
        return {
            key: node.path,
            selectable: node.file !== undefined,
            isLeaf: node.file !== undefined,
            title: (
                <span className={styles.node} data-testid={`upload-review-node-${node.path}`}>
                    {node.file?.indexPath && (
                        <Tooltip title="converted">
                            <FileTextOutlined className={styles.indexed} />
                        </Tooltip>
                    )}
                    {node.name}
                    {decision && (
                        <span className={`${styles.decision} ${decisionStyle[decision]}`}>
                            {decision}
                        </span>
                    )}
                </span>
            ),
            children: node.children.length > 0 ? toTreeData(node.children, decisions) : undefined,
        };
    });
