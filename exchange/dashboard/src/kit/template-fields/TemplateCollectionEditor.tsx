import React from 'react';
import { TemplateCollectionV0, TemplateV0 } from '@cms-kit/template-lang';
import { Button, Checkbox } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { VoiceInput, VoiceTextArea, Tooltip } from '@cms-core';
import { ReorderHandle, moveInArray, useReorderable } from '@cms-kit/reorder';
import { VerticalBar } from './VerticalBar';

/** The variable patterns a template body may hold, as the Syntax Help tooltip reads them out. */
export const SYNTAX_HELP = (
    <div>
        <p><b>Common patterns:</b></p>
        <ul style={{ paddingLeft: '20px', margin: '5px 0' }}>
            <li><code>{'${name}'}</code> — variable</li>
            <li><code>{'${name:text}'}</code> — free text</li>
            <li><code>{'${doc:file}'}</code> — store file</li>
            <li><code>{'${region:AwsRegion}'}</code> — autocompleted type</li>
            <li><code>{'${type:"feat"|"fix"|"chore"}'}</code> — enum</li>
            <li><code>{'${name:text=John}'}</code> — default</li>
        </ul>
        <p style={{ marginTop: '10px', fontSize: '0.9em', color: 'rgba(255,255,255,0.7)' }}>
            One field: <code>{'${key:type.field}'}</code>
        </p>
    </div>
);

const Template: React.FC<{ template: TemplateV0, setTemplate: (template: TemplateV0) => void }> = ({ template, setTemplate }) => {

    const hadDefaultText = template.defaultText !== undefined && template.defaultText !== null;

    return (
        <div style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>
            <VoiceInput
                value={template.id}
                onChange={(event) => setTemplate({ ...template, id: event.target.value })}
                style={{ width: '100%', marginBottom: '5px' }}
                placeholder="Template ID"
                suffix={
                    <Tooltip title="This ID uniquely identifies the template and is used for referencing it in other templates (e.g. ${templateID}).">
                        <QuestionCircleOutlined style={{ color: 'var(--muted)' }} />
                    </Tooltip>
                }
            />
            <div style={{ display: 'flex', flexDirection: 'row', marginLeft: '0.5rem' }}>
                <VerticalBar text={template.id} />
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: '5px' }}>
                        <Checkbox
                            checked={hadDefaultText}
                            onChange={() => setTemplate({ ...template, defaultText: hadDefaultText ? undefined : "" })}
                            style={{ marginRight: '10px' }}
                        >
                            Default Text
                        </Checkbox>
                        <Tooltip title="Makes the template optional in its parent and replace it with the default text if not enabled by the user">
                            <QuestionCircleOutlined style={{ marginRight: '10px', color: 'var(--muted)' }} />
                        </Tooltip>
                        {hadDefaultText && (
                            <VoiceTextArea
                                value={template.defaultText || ""}
                                onChange={(event) => setTemplate({ ...template, defaultText: event.target.value })}
                                autoSize={{ minRows: 2 }}
                                style={{ flex: 1 }}
                            />
                        )}
                    </div>
                    <VoiceTextArea
                        value={template.textTemplate}
                        onChange={(event) => setTemplate({ ...template, textTemplate: event.target.value })}
                        autoSize={{ minRows: 2 }}
                        style={{ width: '100%' }}
                        placeholder="Template Body"
                    />
                    <div style={{ textAlign: 'right', marginTop: '5px' }}>
                        <Tooltip title={SYNTAX_HELP}>
                            <span style={{ cursor: 'help', color: 'var(--muted)', fontSize: '0.9em' }}>
                                <QuestionCircleOutlined style={{ marginRight: '5px' }} />
                                Syntax Help
                            </span>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
};

export interface TemplateCollectionEditorProps {
    /** The template being edited. */
    template: TemplateCollectionV0;
    /** Every edit, as the collection it makes — what the caller writes, and where, is its own. */
    onChange: (next: TemplateCollectionV0) => void;
}

/**
 * Editing a template collection: its name, its index, its Root and its sub-templates — the
 * "Modify Template" face of a `.temp.md` file.
 *
 * The one template editor of the CMS, drawn wherever a template is written: the `.temp.md` file
 * view (`template-edit`), and a class version's body in template mode (`hybridflow-ui`), where
 * the same collection is a version's body parsed rather than a file read. What differs per
 * caller is only where the collection comes from and what an edit is written back to — the
 * editor itself is controlled, holding nothing.
 */
export const TemplateCollectionEditor: React.FC<TemplateCollectionEditorProps> = ({ template, onChange }) => {
    const reorder = useReorderable({
        count: template.subTemplates.length,
        onMove: (from, to) => onChange({ ...template, subTemplates: moveInArray(template.subTemplates, from, to) }),
    });

    const onAdd = () => {
        onChange({
            ...template,
            subTemplates: [
                ...template.subTemplates,
                {
                    id: "",
                    textTemplate: ""
                }
            ]
        });
    };

    const setSubTemplateItem = (offset: number, item: TemplateV0) => {
        onChange({
            ...template,
            subTemplates: template.subTemplates.map((temp, i) => offset === i ? item : temp)
        });
    };

    const setRootTemplate = (item: TemplateV0) => {
        onChange({
            ...template,
            rootTemplate: item
        });
    };

    const onDelete = (offset: number) => {
        onChange({
            ...template,
            subTemplates: template.subTemplates.filter((_, i) => offset !== i)
        });
    };

    return (
        <div>
            <div style={{ marginBottom: '20px' }}>
                <h3 style={{ margin: 0 }}>Name</h3>
                <VoiceInput
                    value={template.name || ""}
                    onChange={(event) => onChange({ ...template, name: event.target.value })}
                    style={{ width: '100%', fontSize: '1.2em' }}
                />
            </div>

            <div style={{ marginBottom: '20px' }}>
                <h3>Index</h3>
                <VoiceTextArea
                    value={template.index}
                    onChange={(event) => onChange({ ...template, index: event.target.value })}
                    autoSize={{ minRows: 1 }}
                    style={{ width: '100%' }}
                />
            </div>

            <h3>Root Template</h3>
            <div style={{ marginBottom: '20px' }}>
                <Template template={template.rootTemplate} setTemplate={setRootTemplate} />
            </div>

            <h3>Sub Templates</h3>
            {template.subTemplates.map((item, offset) =>
                <div key={offset} {...reorder.rowProps(offset)} style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ReorderHandle
                            {...reorder.handleProps(offset)}
                            label={`Reorder ${item.id || `sub template ${offset + 1}`}`}
                        />
                        <span style={{ flex: 1 }} />
                        <Button type="link" danger size="small" onClick={() => onDelete(offset)}>Delete</Button>
                    </div>
                    <Template template={item} setTemplate={temp => setSubTemplateItem(offset, temp)} />
                </div>
            )}

            <div style={{ marginTop: '20px' }}>
                <Button onClick={onAdd}>Add template</Button>
            </div>
        </div>
    );
};
