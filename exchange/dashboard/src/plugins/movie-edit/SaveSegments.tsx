import React from 'react';
import { Alert, Button, Modal, Progress, Spin } from 'antd';
import { SaveOutlined, StopOutlined } from '@ant-design/icons';
import { extractName, Tooltip } from '@cms-core';
import type { SegmentsSave } from './useSaveSegments';
import styles from './MovieEdit.module.css';

/** The last thing an install said: the one line worth showing beside its spinner. */
const lastLineOf = (log: string): string => log.trim().split('\n').pop() ?? '';

/** The service's sentence as a sentence: a capital, and a full stop. */
const sentence = (text: string): string => {
    const trimmed = text.trim();
    const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

/** Save, beside Add segment: every segment as a file of its own. */
export const SaveSegmentsButton: React.FC<{ saving: SegmentsSave }> = ({ saving }) => (
    <Tooltip title="Save each segment as a file of its own beside the video: AV1 and Opus, in Matroska, named after the segment">
        <Button
            size="small"
            icon={<SaveOutlined />}
            disabled={!saving.ready}
            loading={saving.phase.kind === 'starting'}
            onClick={saving.save}
            data-testid="save-segments"
        >
            Save
        </Button>
    </Tooltip>
);

/**
 * Where a save stands, under the panel's header: the install before it, the save as it runs, or why
 * it did not happen — and the two questions it may ask on the way, whether to replace the files
 * already there and whether to install FFmpeg.
 */
export const SaveSegmentsStatus: React.FC<{ saving: SegmentsSave }> = ({ saving }) => {
    const { phase } = saving;
    return (
        <>
            {phase.kind === 'installing' && (
                <div className={styles.saving} data-testid="segments-installing">
                    <div className={styles.savingHead}>
                        <Spin size="small" />
                        <span className={styles.savingWhat}>Installing FFmpeg…</span>
                    </div>
                    <div className={styles.savingDetail}>{lastLineOf(phase.job.log)}</div>
                </div>
            )}

            {phase.kind === 'saving' && (
                <div className={styles.saving} data-testid="segments-saving">
                    <div className={styles.savingHead}>
                        <span className={styles.savingWhat}>
                            Saving {phase.job.current ? extractName(phase.job.current) : 'the segments'}
                            {phase.job.files.length > 1
                                && ` (${Math.min(phase.job.done + 1, phase.job.files.length)} of ${phase.job.files.length})`}
                        </span>
                        <Tooltip title="Stop: the segments already saved stay">
                            <Button
                                size="small"
                                type="text"
                                icon={<StopOutlined />}
                                aria-label="Stop saving"
                                onClick={saving.stop}
                                data-testid="stop-saving"
                            />
                        </Tooltip>
                    </div>
                    <Progress percent={Math.floor(phase.job.progress * 100)} size="small" />
                </div>
            )}

            {phase.kind === 'failed' && (
                <Alert
                    type="error"
                    showIcon
                    title="The segments were not saved"
                    description={phase.message}
                    action={<Button size="small" type="text" onClick={saving.dismiss}>Dismiss</Button>}
                    data-testid="segments-save-failed"
                />
            )}

            <Modal
                open={phase.kind === 'confirming'}
                title="Replace the files already there?"
                okText="Replace"
                okButtonProps={{ danger: true }}
                onOk={saving.confirm}
                onCancel={saving.dismiss}
            >
                {phase.kind === 'confirming' && (
                    <p>
                        The video's folder already has{' '}
                        {phase.replaced.map((file, index) => (
                            <React.Fragment key={file}>
                                {index > 0 && (index === phase.replaced.length - 1 ? ' and ' : ', ')}
                                <code>{file}</code>
                            </React.Fragment>
                        ))}
                        . Saving writes the segments over {phase.replaced.length === 1 ? 'it' : 'them'}.
                    </p>
                )}
            </Modal>

            <Modal
                open={phase.kind === 'needs-ffmpeg'}
                title="Saving segments needs FFmpeg"
                okText="Install FFmpeg"
                onOk={saving.install}
                onCancel={saving.dismiss}
                footer={phase.kind === 'needs-ffmpeg' && !phase.canInstall
                    ? [<Button key="close" onClick={saving.dismiss}>Close</Button>]
                    : undefined}
            >
                {phase.kind === 'needs-ffmpeg' && (
                    <>
                        <p>{sentence(phase.why)}</p>
                        <p>
                            {phase.canInstall
                                ? 'Install it now, as the configuration panel would? The segments are saved as soon as it is in place.'
                                : phase.note}
                        </p>
                    </>
                )}
            </Modal>
        </>
    );
};
