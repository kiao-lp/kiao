import React from 'react';
import { TemplateCollectionEditor } from '@cms-kit/template-fields';
import { useTemplatePersistenceContext } from './TemplatePersistence-ctx';
import { InstantiateTemplate } from './InstantiateTemplate';

// Kept here so the tooltip guard (src/tooltips.test.tsx) reads it where it always has: the help
// itself lives with the editor that draws it, in `@cms-kit/template-fields`.
export { SYNTAX_HELP } from '@cms-kit/template-fields';

export interface TemplateEditorProps {
    mode: 'edit' | 'instantiate';
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({ mode }) => {
    const { template, setTemplate } = useTemplatePersistenceContext();

    if (!template) {
        return <div>Loading...</div>;
    }

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* The tab's scroll container: a template taller than the tab scrolls as a whole. The
                edit face already scrolls on its own, so this only ever engages in instantiate mode. */}
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {mode === 'instantiate' ? (
                    <InstantiateTemplate />
                ) : (
                    <div style={{ height: '100%', overflow: 'auto', padding: '20px' }}>
                        <TemplateCollectionEditor template={template} onChange={setTemplate} />
                    </div>
                )}
            </div>
        </div>
    );
};
