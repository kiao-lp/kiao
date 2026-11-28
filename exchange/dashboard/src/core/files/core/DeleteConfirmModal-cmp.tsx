import React from 'react';
import { extractName } from 'src/core/files/service';
import { ConfirmationDialog } from '../../ui-foundation/forms/ConfirmationDialog';
import { DeleteScope } from './deleteScope';

interface DeleteConfirmModalProps {
    scope: DeleteScope | null;
    onConfirm: () => Promise<void> | void;
    onCancel: () => void;
}

/** Cap the preview so large directories remain responsive. */
const LISTED = 200;

const title = ({ selection, entries, truncated }: DeleteScope): string => {
    const what = selection.length === 1
        ? `"${extractName(selection[0])}"`
        : `${selection.length} items`;
    const inside = entries.length - selection.length;
    if (inside <= 0 && !truncated) return `Delete ${what}?`;
    return truncated
        ? `Delete ${what} and more than ${inside} entries inside?`
        : `Delete ${what} and the ${inside} ${inside === 1 ? 'entry' : 'entries'} inside?`;
};

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({ scope, onConfirm, onCancel }) => {
    const entries = scope?.entries ?? [];
    const listed = entries.slice(0, LISTED);
    const rest = entries.length - listed.length;

    return (
        <ConfirmationDialog
            title={scope ? title(scope) : ''}
            open={scope !== null}
            onConfirm={() => { void onConfirm(); }}
            onCancel={onCancel}
            description={<>
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
            </>}
        />
    );
};
