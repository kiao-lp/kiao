import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Radio, Tree } from 'antd';
import type { TreeDataNode } from 'antd';
import { FileTextOutlined, WarningOutlined } from '@ant-design/icons';
import { GateMatcher, GatedTextView } from '../../../import-gate';
import { ConfiguredMarkdown } from '../../../markdown/ConfiguredMarkdown';
import { Tooltip } from '../../../ui/Tooltip';
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

/**
 * Markdown is shown as the document it is and not as its source — an index is Markdown, and so is
 * half of what anyone uploads. Held at module scope because the reader takes it as a prop: a new
 * function every render would be a new document every render.
 */
const renderMarkdown = (text: string) => <ConfiguredMarkdown revealLinkTargets={false}>{text}</ConfiguredMarkdown>;

export interface UploadReviewModalProps {
    /** The upload to answer for, or null when none is waiting. */
    review: UploadReview | null;
    /** Reads one file out of the staging area, as text — an index, or a document that is text. */
    loadIndex: (path: string) => Promise<string>;
    /** Throw the whole upload away: nothing is imported. */
    onCancel: () => void;
    /**
     * Carry the decisions out: import what is kept, delete the rest, and write back the texts a
     * reviewer obfuscated a passage of — by staging-relative path, as {@link planImport} takes them.
     */
    onImport: (decisions: UploadDecisions, redactions: Record<string, string>) => void;
    /** An import is running; the dialog stays up and inert until it lands. */
    busy?: boolean;
    /**
     * The store's import gate — what is worth pointing out in the text of a document, and how
     * badly. Empty when the store has no `kiao-user-config/import-gate/`, which draws the index
     * exactly as before.
     */
    matchers?: GateMatcher[];
}

/**
 * What an upload landed with, before any of it is in the store.
 *
 * The tree of what arrived is on the left and what each document was converted into is on the
 * right, because the question this dialog exists to ask — is this file worth keeping? — cannot be
 * answered from a file name. Marking one *Delete* is the whole point: a folder handed over on a key
 * or exported from a mailbox is worth uploading precisely because nobody yet knows what is in it.
 *
 * The right-hand pane is a {@link GatedTextView}: the store's import gate is run over the text and
 * what it finds is highlighted at its criticality, with a navigator to step through it. Reading
 * eleven pages to answer one question is what nobody does, so the findings are counted first.
 *
 * It cannot be dismissed by Escape or by clicking away. Every way out of it decides the fate of
 * files that are on the store's disk and in no listing, so each has to be a button somebody meant
 * to press.
 */
export const UploadReviewModal: React.FC<UploadReviewModalProps> = ({
    review, loadIndex, onCancel, onImport, busy, matchers,
}) => {
    const [decisions, setDecisions] = useState<UploadDecisions>({});
    const [selected, setSelected] = useState<string | null>(null);
    const [indexText, setIndexText] = useState<string | null>(null);
    /**
     * The texts a reviewer has obfuscated a passage of, by staging-relative path. Kept here and not
     * in the reader, because they have to outlive selecting another file: a redaction is a decision
     * about what gets imported, and it is only carried out when an import runs.
     */
    const [redactions, setRedactions] = useState<Record<string, string>>({});
    // Which import was pressed, so the spinner sits on the button somebody clicked rather than on
    // both of them.
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

    // A file whose text was redacted comes back redacted: what is shown is always what would be
    // imported, and re-reading the staging copy would silently undo the reviewer's own cut.
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
        // `redactions` is deliberately not a dependency: obfuscating already sets the shown text,
        // and re-running here would fight the reader over which of the two is newer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [review, textPath, loadIndex]);

    /** An obfuscated passage: shown at once, remembered for the import, written at import time. */
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
                            {/* Only where a conversion actually wrote something: with no index
                                there is no text to put in the document's place. */}
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

/** The colour each answer is reported in beside the file. Its word is there too — see the CSS. */
const decisionStyle: Record<UploadDecision, string> = {
    import: styles.import,
    delete: styles.delete,
    text: styles.asText,
};

/** Maps the review's own tree onto antd's, hanging each file's decision off its label. */
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
