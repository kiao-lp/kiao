import React from 'react';
import { ActionParamsModal } from './ActionParamsModal-cmp';
import { useServerActions } from './useServerActions';

/**
 * Server-provided file actions: the menu entries and the parameter prompt they may open.
 *
 * Mounted beside the browser's own modals so the registration and its dialog live together, the
 * same arrangement `RenameModal` and `DeleteConfirmModal` have.
 */
export const ServerActions: React.FC = () => {
    const { prompt, confirmPrompt, cancelPrompt } = useServerActions();
    return <ActionParamsModal prompt={prompt} onConfirm={confirmPrompt} onCancel={cancelPrompt} />;
};
