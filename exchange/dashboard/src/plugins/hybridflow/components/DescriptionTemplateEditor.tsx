import React, { useMemo, useState } from 'react';
import { TemplateCollectionEditor } from '@kiao-dashboard-kit/template-fields';
import { serializeTempMd, type TemplateCollectionV0 } from '@kiao-dashboard-kit/template-lang';
import { flowNodeBodyTemplate, parseDescriptionTemplate } from '../flowNodeTemplates';

export const DescriptionTemplateEditor: React.FC<{
    body: string;
    onChange: (body: string) => void;
    editName?: boolean;
    disabled?: boolean;
}> = ({ body, onChange, editName = false, disabled }) => {
    // Keep an in-progress edit (such as an unfinished sub-template ID) through the save echo.
    const [local, setLocal] = useState<{ body: string; template: TemplateCollectionV0 }>();
    const template = useMemo(() => {
        if (local?.body === body) return local.template;
        return editName ? parseDescriptionTemplate(body) : flowNodeBodyTemplate(body, true);
    }, [local, body, editName]);

    return (
        <TemplateCollectionEditor
            template={template}
            editName={editName}
            disabled={disabled}
            onChange={next => {
                if (disabled) return;
                const source = serializeTempMd(next);
                setLocal({ body: source, template: next });
                onChange(source);
            }}
        />
    );
};
