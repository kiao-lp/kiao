import React from 'react';
import { ChatLink } from './FlowNodeControls';
import styles from '../Hybridflow.module.css';

interface FlowNodeStateEditorProps {
    chat: string;
    showChat: boolean;
    onOpenChat: () => void;
    onUnlinkChat: () => void;
}

export const FlowNodeStateEditor: React.FC<FlowNodeStateEditorProps> = ({
    chat, showChat, onOpenChat, onUnlinkChat,
}) => {
    if (!showChat) return null;
    return (
        <div className={styles.meta} data-testid="flow-node-state">
            <div className={styles.metaRow}>
                <ChatLink chat={chat} onOpen={onOpenChat} onUnlink={onUnlinkChat} />
            </div>
        </div>
    );
};
