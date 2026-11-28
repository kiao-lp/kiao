import React from 'react';
import { TemplateCollectionEditor } from '@kiao-dashboard-kit/template-fields';
import { useTemplatePersistenceContext } from './TemplatePersistence-ctx';
import { InstantiateTemplate } from './InstantiateTemplate';

export interface TemplateEditorProps {
    mode: 'edit' | 'instantiate';
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({ mode }) => {
    const { template, setTemplate } = useTemplatePersistenceContext();

    if (!template) {
        return <div>Loading...</div>;
    }

    return (
        <div style={{ height: '100%', overflow: 'auto' }}>
            {mode === 'instantiate' ? (
                <InstantiateTemplate />
            ) : (
                <div style={{ padding: '12px 16px' }}>
                    <TemplateCollectionEditor template={template} onChange={setTemplate} />
                </div>
            )}
        </div>
    );
};
