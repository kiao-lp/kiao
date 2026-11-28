import React, { useEffect, useId, useRef } from 'react';
import { Input, type InputRef } from 'antd';
import { CloseOutlined, DeleteOutlined } from '@ant-design/icons';
import { CommitInput, IconButton, useConfirmation, useFileDrop, useFilesDrop } from '@kiao-dashboard-core';
import { dcmsLinkOf } from 'kiao-worker/utils';
import { workflowFilesError, type Workflow } from '../boardContent';
import { normalizeFolder } from '../flowNodeSettings';
import { useHybridflow } from '../Hybridflow-ctx';
import { workflowDeletion } from './workflowDeletion';
import styles from '../Hybridflow.module.css';
import { WorkflowValuesEditor } from './WorkflowValuesEditor';

export const WorkflowPanel: React.FC = () => {
    const confirm = useConfirmation();
    const {
        handle, selectedWorkflowGroup: workflow, editWorkflow, removeWorkflows,
        titleCaret, takeTitleCaret,
    } = useHybridflow();
    const nameRef = useRef<InputRef>(null);

    useEffect(() => {
        if (!workflow || titleCaret !== workflow.id) return;
        takeTitleCaret();
        nameRef.current?.focus();
    }, [workflow, titleCaret, takeTitleCaret]);

    if (!workflow) {
        return <div className={styles.panelHint}>Select a workflow on the board to edit it.</div>;
    }

    return (
        <div className={styles.panel} data-testid="workflow-panel">
            <div className={styles.panelHeader}>
                <span className={styles.panelKind}>Workflow</span>
                <IconButton
                    label="Delete workflow"
                    danger
                    icon={<DeleteOutlined />}
                    data-testid="delete-workflow"
                    onClick={() => confirm({
                        ...workflowDeletion(workflow.name),
                        onConfirm: () => removeWorkflows([workflow.id]),
                    })}
                />
            </div>
            <Input
                ref={nameRef}
                size="small"
                className={styles.panelTitle}
                value={workflow.name}
                placeholder="Workflow name"
                aria-label="Workflow name"
                data-testid="workflow-name"
                onChange={event => editWorkflow(workflow.id, event.target.value)}
            />
            <WorkflowFields key={`${handle}/${workflow.id}`} workflow={workflow} />
        </div>
    );
};

const WorkflowFields: React.FC<{ workflow: Workflow }> = ({ workflow }) => {
    const { editWorkflowFiles } = useHybridflow();
    const folderId = useId();
    const error = workflowFilesError(workflow);
    const setFolder = (workflowFolder: string) => {
        void editWorkflowFiles(workflow.id, current =>
            workflowFolder === (current.workflowFolder ?? '') ? null : { workflowFolder });
    };
    const folderDrop = useFileDrop(file => {
        if (file.isDirectory) setFolder(dcmsLinkOf(file.path));
    });
    const filesDrop = useFilesDrop(dropped => {
        const links = dropped.map(file => dcmsLinkOf(file.path));
        void editWorkflowFiles(workflow.id, current => {
            const existing = current.files ?? [];
            const files = Array.from(new Set([...existing, ...links]));
            return files.length === existing.length ? null : { files };
        });
    });
    const removeFile = (path: string) => {
        void editWorkflowFiles(workflow.id, current => current.files?.includes(path)
            ? { files: current.files.filter(file => file !== path) }
            : null);
    };

    return (
        <>
            <div className={styles.workflowField}>
                <label htmlFor={folderId}>Folder</label>
                <CommitInput
                    id={folderId}
                    value={workflow.workflowFolder ?? ''}
                    placeholder="/workflow-folder"
                    aria-invalid={!!error && !workflow.workflowFolder}
                    className={folderDrop.dropping ? styles.workflowFolderDrop : undefined}
                    onCommit={value => setFolder(value.trim() ? dcmsLinkOf(normalizeFolder(value)) : '')}
                    {...folderDrop.dropProps}
                />
            </div>
            {error && <div role="alert" className={styles.workflowInvalid}>{error}</div>}
            <div className={styles.workflowSections}>
                <section className={styles.workflowSection} aria-label="Files" {...filesDrop.dropProps}>
                    <div>Files</div>
                    <div className={[styles.workflowFiles, filesDrop.dropping && styles.workflowFilesDrop].filter(Boolean).join(' ')}>
                        {workflow.files?.length ? (
                            <ul>
                                {workflow.files.map(file => (
                                    <li key={file}>
                                        <span title={file}>{file}</span>
                                        <IconButton
                                            danger
                                            label={`Remove ${file}`}
                                            icon={<CloseOutlined />}
                                            onClick={() => removeFile(file)}
                                        />
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className={styles.workflowDropHint}>Drop files or folders from the File tree.</div>
                        )}
                    </div>
                </section>
                <WorkflowValuesEditor workflow={workflow} />
            </div>
        </>
    );
};
