import React from 'react';
import { ActionParamsModal } from './ActionParamsModal-cmp';
import { useServerActions } from './useServerActions';

export const ServerActions: React.FC = () => {
    const { prompt, confirmPrompt, cancelPrompt } = useServerActions();
    return <ActionParamsModal prompt={prompt} onConfirm={confirmPrompt} onCancel={cancelPrompt} />;
};
