import React, { useEffect, useState } from 'react';
import { Alert, Checkbox, Input, Modal } from 'antd';

export interface GitConsolidateModalProps {
    open: boolean;
    branch: string;
    /** The upstream ref (`origin/main`) when the branch tracks one, else undefined. */
    upstream?: string;
    busy: boolean;
    onConfirm: (message: string, pushRemote: boolean) => void;
    onCancel: () => void;
}

const DEFAULT_MESSAGE = 'Consolidated history';

/**
 * Confirms the one irreversible action the Git panel offers: replacing the whole history
 * with a single commit to reclaim the space it holds. The force-push option is the part
 * that decides whether anything is actually freed on a branch with an upstream — the
 * remote-tracking ref keeps every old object alive until the remote is rewritten too — so
 * it is offered here rather than assumed either way.
 */
export const GitConsolidateModal: React.FC<GitConsolidateModalProps> = ({
    open, branch, upstream, busy, onConfirm, onCancel,
}) => {
    const [message, setMessage] = useState(DEFAULT_MESSAGE);
    const [pushRemote, setPushRemote] = useState(true);

    useEffect(() => {
        if (open) {
            setMessage(DEFAULT_MESSAGE);
            setPushRemote(true);
        }
    }, [open]);

    return (
        <Modal
            title="Consolidate repository"
            open={open}
            onOk={() => onConfirm(message, !!upstream && pushRemote)}
            onCancel={onCancel}
            okText="Consolidate"
            okButtonProps={{ danger: true, loading: busy }}
            cancelButtonProps={{ disabled: busy }}
            destroyOnHidden
        >
            <p>
                Squashes every commit of <b>{branch}</b> into a single root commit holding the
                current content, then drops every object left unreachable — the whole history and
                every diff against it. Uncommitted changes are left exactly as they are.
            </p>
            <Input
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={DEFAULT_MESSAGE}
                disabled={busy}
                aria-label="Consolidated commit message"
            />
            {upstream && (
                <Checkbox
                    style={{ marginTop: 12 }}
                    checked={pushRemote}
                    disabled={busy}
                    onChange={e => setPushRemote(e.target.checked)}
                >
                    Force-push the rewritten history to <b>{upstream}</b>
                </Checkbox>
            )}
            {upstream && !pushRemote && (
                <Alert
                    style={{ marginTop: 12 }}
                    type="warning"
                    showIcon
                    message={`${upstream} keeps the old history`}
                    description={`Little space is freed while it does, and ${branch} then diverges from it: pulling and pushing stay blocked until the remote is rewritten.`}
                />
            )}
            <p style={{ marginTop: 12, opacity: 0.7 }}>
                Repacking a large repository takes minutes; the panel waits for the report.
            </p>
        </Modal>
    );
};
