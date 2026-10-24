import React, { useEffect, useState } from 'react';
import { Input, Modal } from 'antd';

export interface GitCreateBranchModalProps {
    open: boolean;
    busy: boolean;
    onConfirm: (name: string) => void;
    onCancel: () => void;
}

/**
 * Names the branch the panel is about to start: at the current commit, and switched to, so it
 * is also how a detached HEAD is given a name again. An invalid or already-taken name is refused
 * by the service, and that refusal is what the panel reports.
 */
export const GitCreateBranchModal: React.FC<GitCreateBranchModalProps> = ({
    open, busy, onConfirm, onCancel,
}) => {
    const [name, setName] = useState('');

    useEffect(() => {
        if (open) setName('');
    }, [open]);

    const trimmed = name.trim();
    const confirm = () => { if (trimmed) onConfirm(trimmed); };

    return (
        <Modal
            title="Create branch"
            open={open}
            onOk={confirm}
            onCancel={onCancel}
            okText="Create"
            okButtonProps={{ disabled: !trimmed, loading: busy }}
            cancelButtonProps={{ disabled: busy }}
            destroyOnHidden
        >
            <p>Starts a branch at the current commit and switches to it.</p>
            <Input
                value={name}
                onChange={e => setName(e.target.value)}
                onPressEnter={confirm}
                placeholder="feature/my-branch"
                disabled={busy}
                autoFocus
                aria-label="New branch name"
            />
        </Modal>
    );
};
