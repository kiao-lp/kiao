import React from 'react';
import { Modal } from 'antd';

export interface CutConfirmModalProps {

    pending: string[] | null;
    onConfirm: () => void;
    onCancel: () => void;
}

/** What a cut asks before taking anything off the map. */
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
