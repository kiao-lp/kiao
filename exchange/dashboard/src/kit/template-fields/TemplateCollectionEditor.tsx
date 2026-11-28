import React, { useId } from 'react';
import { Button, Checkbox } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import {
    FormField, FormFields, ReorderableList, Tooltip, VoiceInput, VoiceTextArea, moveInArray,
} from '@kiao-dashboard-core';
import type { TemplateCollectionV0, TemplateV0 } from '@kiao-dashboard-kit/template-lang';
import styles from './TemplateCollectionEditor.module.css';

export const SYNTAX_HELP = 'Use ${name}, ${name:text}, ${doc:file}, ${region:AwsRegion}, ${type:"feat"|"fix"}, ${name:text=John}, or ${key:type.field}. Use ${templateId} for sub-templates.';

const SubTemplateFields: React.FC<{
    template: TemplateV0;
    handle: React.ReactNode;
    onChange: (next: TemplateV0) => void;
    onDelete: () => void;
}> = ({ template, handle, onChange, onDelete }) => (
    <>
        <div className={styles.subTemplateHeader}>
            {handle}
            <VoiceInput
                aria-label="Template ID"
                placeholder="Template ID"
                className={styles.templateId}
                value={template.id}
                onChange={event => onChange({ ...template, id: event.target.value })}
            />
            <Button type="link" danger onClick={onDelete}>Delete</Button>
        </div>
        <VoiceTextArea
            aria-label="Template Body"
            placeholder="Template Body"
            value={template.textTemplate}
            autoSize={{ minRows: 3 }}
            onChange={event => onChange({ ...template, textTemplate: event.target.value })}
        />
        <Checkbox
            checked={template.defaultText != null}
            onChange={event => onChange({ ...template, defaultText: event.target.checked ? '' : undefined })}
        >
            Default Text
        </Checkbox>
        {template.defaultText != null && (
            <VoiceTextArea
                aria-label="Text when disabled"
                placeholder="Text when disabled"
                value={template.defaultText}
                autoSize={{ minRows: 2 }}
                onChange={event => onChange({ ...template, defaultText: event.target.value })}
            />
        )}
    </>
);

export interface TemplateCollectionEditorProps {
    template: TemplateCollectionV0;
    onChange: (next: TemplateCollectionV0) => void;
    editName?: boolean;
    disabled?: boolean;
}

export const TemplateCollectionEditor: React.FC<TemplateCollectionEditorProps> = ({
    template, onChange, editName = true, disabled,
}) => {
    const nameId = useId();
    const rootId = useId();
    const { subTemplates } = template;
    const setSubTemplates = (next: TemplateV0[]) => onChange({ ...template, subTemplates: next });

    return (
        <FormFields className={styles.editor} disabled={disabled}>
            {editName && (
                <FormField label="Name" htmlFor={nameId}>
                    <VoiceInput
                        id={nameId}
                        value={template.name ?? ''}
                        onChange={event => onChange({ ...template, name: event.target.value })}
                    />
                </FormField>
            )}
            <FormField label="Root Template" htmlFor={rootId}>
                <VoiceTextArea
                    id={rootId}
                    value={template.rootTemplate.textTemplate}
                    placeholder="Template Body"
                    autoSize={{ minRows: 4 }}
                    onChange={event => onChange({
                        ...template, rootTemplate: { ...template.rootTemplate, textTemplate: event.target.value },
                    })}
                />
            </FormField>
            {subTemplates.length > 0 && (
                <FormField label="Sub-templates">
                    <ReorderableList
                        items={subTemplates}
                        disabled={disabled}
                        onMove={(from, to) => setSubTemplates(moveInArray(subTemplates, from, to))}
                        rowProps={{ className: styles.subTemplate }}
                        handleLabel={(item, index) => `Reorder ${item.id || `sub template ${index + 1}`}`}
                    >
                        {(item, index, handle) => (
                            <SubTemplateFields
                                template={item}
                                handle={handle}
                                onChange={next => setSubTemplates(subTemplates.map((current, i) => i === index ? next : current))}
                                onDelete={() => setSubTemplates(subTemplates.filter((_, i) => i !== index))}
                            />
                        )}
                    </ReorderableList>
                </FormField>
            )}
            <div className={styles.actions}>
                <Button onClick={() => setSubTemplates([...subTemplates, { id: '', textTemplate: '' }])}>
                    Add template
                </Button>
                <Tooltip title={SYNTAX_HELP} placement="topRight" trigger={['hover', 'focus']}>
                    <Button type="text" icon={<QuestionCircleOutlined aria-hidden="true" />}>Syntax Help</Button>
                </Tooltip>
            </div>
        </FormFields>
    );
};
