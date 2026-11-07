import React from 'react';
import { Modal } from 'antd';
import { extractName } from 'src/cms-core/files/service';
import { DeleteScope } from './deleteScope';

export interface DeleteConfirmModalProps {
    scope: DeleteScope | null;
    onConfirm: () => void;
    onCancel: () => void;
}

/** How many entries the dialog spells out. Past this, what is left is a count. */
const LISTED = 200;

/**
 * What is being deleted, and how much comes with it.
 *
 * The count is what the selection *drags along*, not the total: "delete this folder and the 412
 * entries inside" is the sentence someone can act on. An unknown scope — the server could not be
 * asked — degrades to naming the selection, which is the part that is never in doubt.
 */
const title = ({ selection, entries, truncated }: DeleteScope): string => {
    const what = selection.length === 1
        ? `"${extractName(selection[0])}"`
        : `${selection.length} items`;
    const inside = entries.length - selection.length;
    if (inside <= 0 && !truncated) return `Delete ${what}?`;
    return truncated
        ? `Delete ${what} and the more than ${inside} entries inside?`
        : `Delete ${what} and the ${inside} ${inside === 1 ? 'entry' : 'entries'} inside?`;
};

/**
 * Confirms a delete by describing its scope rather than enumerating it.
 *
 * The list used to hold every descendant of every selected folder, which on a folder holding a
 * `node_modules` was a hundred thousand list items — a dialog that froze the browser instead of
 * informing anyone. What a person can act on is what they selected, how much goes with it, and a
 * readable sample; the rest is a number.
 */
export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({ scope, onConfirm, onCancel }) => {
    const entries = scope?.entries ?? [];
    const listed = entries.slice(0, LISTED);
    const rest = entries.length - listed.length;

    return (
        <Modal
            title="Delete"
            open={scope !== null}
            onOk={onConfirm}
            onCancel={onCancel}
            okText="Delete"
            okButtonProps={{ danger: true, autoFocus: true }}
            destroyOnHidden
        >
            <div data-testid="delete-confirm-message">
                {scope && <p>{title(scope)}</p>}
                {listed.length > 1 && (
                    <ul style={{ maxHeight: 320, overflowY: 'auto', paddingLeft: 20 }}>
                        {listed.map(entry => <li key={entry.path}>{entry.path}</li>)}
                    </ul>
                )}
                {(rest > 0 || scope?.truncated) && (
                    <p data-testid="delete-confirm-more">
                        {scope?.truncated ? `…and more than ${rest}` : `…and ${rest} more`}
                    </p>
                )}
            </div>
        </Modal>
    );
};
