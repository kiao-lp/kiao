import React from 'react';
import { Modal } from 'antd';

export interface CutConfirmModalProps {
    /** What the cut put on the clipboard and is waiting on, or nothing when no cut is waiting. */
    pending: string[] | null;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * What a cut asks before taking anything off the map.
 *
 * A cut has already copied: the piece is on the system clipboard and can be pasted from here on,
 * in this map or in another tab's. So this asks the one question left — whether the original may
 * go — and waits for it to be answered, however long that takes and whether or not the paste has
 * happened yet. Refusing it leaves the map untouched and the clipboard full, which is a copy.
 */
export const CutConfirmModal: React.FC<CutConfirmModalProps> = ({ pending, onConfirm, onCancel }) => {
    const count = pending?.length ?? 0;

    return (
        <Modal
            title="Cut"
            open={pending !== null}
            onOk={onConfirm}
            onCancel={onCancel}
            okText="Delete"
            cancelText="Keep"
            okButtonProps={{ danger: true, autoFocus: true }}
            destroyOnHidden
        >
            <p data-testid="cut-confirm-message">
                {count === 1
                    ? 'One element is on the clipboard. Delete it from this map?'
                    : `${count} elements are on the clipboard. Delete them from this map?`}
            </p>
            <p>Paste first if you like — this will wait.</p>
        </Modal>
    );
};
