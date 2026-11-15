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
    flowNodeId: string;
    type: FlowNodeType;

    settings: FlowNodeSettings;
    onChange: (next: FlowNodeSuccess) => void;
    readOnly?: boolean;
}

/** AI cards can compact and hand on their conversation independently of naming a successor. */
export const FlowNodeSuccessEditor: React.FC<FlowNodeSuccessEditorProps> = ({
    success, content, flowNodeId, type, settings, onChange, readOnly,
}) => (
    <div className={styles.meta} data-testid="flow-node-success">

        <div className={styles.metaRow}>
            {hasTransition(type)
                && <CompactCheck success={success} settings={settings} onChange={onChange} disabled={readOnly} />}
            {hasTransition(type)
                && <TransitionModeSelect success={success} settings={settings} onChange={onChange} disabled={readOnly} />}
            <NextFlowNodeSelect
                success={success} content={content} flowNodeId={flowNodeId}
                multiple={type === 'gateway'} onChange={onChange}
                disabled={readOnly}
            />
        </div>
    </div>
);
