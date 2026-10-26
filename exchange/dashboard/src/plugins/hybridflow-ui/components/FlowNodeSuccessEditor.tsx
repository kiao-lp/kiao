import React from 'react';
import { FlowNodeSettings } from '../flowNodeSettings';
import { FlowNodeSuccess } from '../flowNodeSuccess';
import { hasTransition, FlowNodeType } from '../flowNodeType';
import { BoardContent } from '../boardContent';
import { CompactCheck, NextFlowNodeSelect, TransitionModeSelect } from './FlowNodeControls';
import styles from '../Hybridflow.module.css';

interface FlowNodeSuccessEditorProps {
    success: FlowNodeSuccess;
    content: BoardContent;
    /** Excluded from successors to prevent self-chaining. */
    flowNodeId: string;
    type: FlowNodeType;
    /** Determines whether a transition requiring a played turn is supported. */
    settings: FlowNodeSettings;
    onChange: (next: FlowNodeSuccess) => void;
}

/**
 * AI cards can compact and hand on their conversation independently of naming a successor.
 * Continue forks the chat; End conversation starts the successor in a fresh chat.
 * Successor chains also apply to non-AI cards, except Shutdown; Gateways select multiple.
 */
export const FlowNodeSuccessEditor: React.FC<FlowNodeSuccessEditorProps> = ({
    success, content, flowNodeId, type, settings, onChange,
}) => (
    <div className={styles.meta} data-testid="flow-node-success">
        {/* Keep the checkbox at its natural width;
            the selects share the remaining space. */}
        <div className={styles.metaRow}>
            {hasTransition(type)
                && <CompactCheck success={success} settings={settings} onChange={onChange} />}
            {hasTransition(type)
                && <TransitionModeSelect success={success} settings={settings} onChange={onChange} />}
            <NextFlowNodeSelect
                success={success} content={content} flowNodeId={flowNodeId}
                multiple={type === 'gateway'} onChange={onChange}
            />
        </div>
    </div>
);
