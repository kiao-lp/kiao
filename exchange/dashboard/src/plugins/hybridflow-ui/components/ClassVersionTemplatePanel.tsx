import React, { useEffect, useRef, useState } from 'react';
import { TemplateCollectionEditor } from '@cms-kit/template-fields';
import { serializeTempMd, TemplateCollectionV0 } from '@cms-kit/template-lang';
import { useHybridflow } from '../Hybridflow-ctx';
import { versionBodyTemplate } from '../flowNodeTemplates';
import styles from '../Hybridflow.module.css';

/** The version template editor's entry on the central area's stack. */
export const CLASS_VERSION_TEMPLATE_PANEL_ID = 'class-version-template';

interface ClassVersionTemplatePanelProps {
    /** The class and version being edited — read live, so the panel is never a stale copy. */
    classId: string;
    versionId: string;
}

/** A class version's body in template mode, edited as the template it is: the same. */
export const ClassVersionTemplatePanel: React.FC<ClassVersionTemplatePanelProps> = ({
    classId, versionId,
}) => {
    const { content, editClassVersion } = useHybridflow();
    const flowNodeClass = content?.flowNodeClasses.find(one => one.id === classId) ?? null;
    const version = flowNodeClass?.versions.find(one => one.id === versionId) ?? null;

    const [template, setTemplateState] = useState<TemplateCollectionV0 | null>(null);

    const written = useRef<string | null>(null);

    useEffect(() => {
        if (!flowNodeClass || !version) return;
        if (template !== null && written.current === version.body) return;
        written.current = version.body;
        setTemplateState(versionBodyTemplate(version.body, flowNodeClass.title));
    }, [flowNodeClass, version, template]);

    if (!flowNodeClass || !version) {
        return <div className={styles.panelHint}>That version is gone from the board.</div>;
    }
    if (version.status !== 'draft') {
        return <div className={styles.panelHint}>Published versions are read-only — what stays said stays.</div>;
    }
    if (!template) {
        return <div>Loading...</div>;
    }

    const onChange = (next: TemplateCollectionV0) => {
        setTemplateState(next);
        const body = serializeTempMd(next);
        written.current = body;
        editClassVersion(classId, versionId, { body });
    };

    return (
        <div data-testid="class-version-template-editor">
            <TemplateCollectionEditor template={template} onChange={onChange} />
        </div>
    );
};
