import React, { useEffect, useRef } from 'react';
import { Button, Input, Modal, type InputRef } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { SelectedWorkflow, useHybridflow } from '../Hybridflow-ctx';
import { Workflow, WorkflowClass } from '../boardContent';
import styles from '../Hybridflow.module.css';

/**
 * The open workflow: its name in a box of its own, and nothing else — a name is all a
 * rectangle has. The same panel edits a workflow class; the kind line says which is open.
 *
 * A rectangle made on the canvas arrives unnamed — the menu picked cards, not a name — so
 * the panel it opens takes the focus into the name, the way a card made on the canvas does.
 * Taking the rectangle off ungroups its cards, which stay where they are.
 */
export const WorkflowPanel: React.FC = () => {
    const {
        content, selectedWorkflow, selectedWorkflowGroup,
        editWorkflow, editWorkflowClass, removeWorkflows, removeWorkflowClasses,
        titleCaret, takeTitleCaret,
    } = useHybridflow();
    const nameRef = useRef<InputRef>(null);

    const group = selectedWorkflowGroup;

    useEffect(() => {
        if (!group || titleCaret !== group.id) return;
        takeTitleCaret();
        nameRef.current?.focus();
    }, [group, titleCaret, takeTitleCaret]);

    if (!selectedWorkflow || !group || !content) {
        return <div className={styles.panelHint}>Select a workflow on the board to edit it.</div>;
    }

    const isClass = selectedWorkflow.kind === 'workflowClass';
    const rename = (name: string) => (isClass
        ? editWorkflowClass(group.id, name)
        : editWorkflow(group.id, name));
    const remove = () => (isClass
        ? removeWorkflowClasses([group.id])
        : removeWorkflows([group.id]));

    return (
        <div className={styles.panel} data-testid="workflow-panel">
            <div className={styles.panelHeader}>
                <span className={styles.panelKind}>{isClass ? 'Workflow class' : 'Workflow'}</span>
                <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={isClass ? 'Delete workflow class' : 'Delete workflow'}
                    data-testid="delete-workflow"
                    onClick={() => confirmDelete(selectedWorkflow, group, remove)}
                />
            </div>
            <Input
                ref={nameRef}
                size="small"
                className={styles.panelTitle}
                value={group.name}
                placeholder={isClass ? 'Workflow class name' : 'Workflow name'}
                aria-label={isClass ? 'Workflow class name' : 'Workflow name'}
                data-testid="workflow-name"
                onChange={event => rename(event.target.value)}
            />
        </div>
    );
};

const confirmDelete = (
    selected: SelectedWorkflow, group: Workflow | WorkflowClass, remove: () => void,
): void => {
    const isClass = selected.kind === 'workflowClass';
    Modal.confirm({
        title: `Delete the workflow ${isClass ? 'class ' : ''}“${group.name || 'Untitled'}”?`,
        content: isClass
            ? 'Its classes are ungrouped and stay where they are.'
            : 'Its cards are ungrouped and stay where they are.',
        okText: isClass ? 'Delete workflow class' : 'Delete workflow',
        okType: 'danger',
        cancelText: 'Keep it',
        onOk: remove,
    });
};
