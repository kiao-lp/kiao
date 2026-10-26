import React from 'react';
import { FlowNodeStatus } from '../flowNodeStatus';
import { ChatLink, StatusSelect } from './FlowNodeControls';
import styles from '../Hybridflow.module.css';

interface FlowNodeStateEditorProps {
    status: FlowNodeStatus;
    /** Linked conversation, reused by later plays; `''` means none. */
    chat: string;
    /** Hide chat controls when the build has no chat support. */
    showChat: boolean;
    onStatus: (next: FlowNodeStatus) => void;
    onOpenChat: () => void;
    /** Unlinks without deleting the conversation. */
    onUnlinkChat: () => void;
}

/** Status edits leave the card's board placement unchanged; chat is assigned by play. */
export const FlowNodeStateEditor: React.FC<FlowNodeStateEditorProps> = ({
    status, chat, showChat, onStatus, onOpenChat, onUnlinkChat,
}) => (
    <div className={styles.meta} data-testid="flow-node-state">
        <div className={styles.metaRow}>
            <StatusSelect status={status} onChange={onStatus} />
            {showChat && <ChatLink chat={chat} onOpen={onOpenChat} onUnlink={onUnlinkChat} />}
        </div>
    </div>
);
