import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Spin } from 'antd';
import { useWorkerClient } from '@cms-core';
import { KiaoElHeap, TemplateCollectionV0 } from '@cms-kit/template-lang';
import { TemplateInstantiation } from '@cms-kit/template-fields';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { DESCRIPTION_VARIABLE, loadFlowNodeTemplate, TITLE_VARIABLE } from '../flowNodeTemplates';

interface TemplateInstantiationPanelProps {
    /** Store `.temp.md` path. Supply either `path` or `inline`, never both. */
    path?: string;
    /** Class-version template; its title fills `${flowNodeTitle}`. */
    inline?: { template: TemplateCollectionV0; title: string };
    /** Replaces the description, or supplies one class body to the instantiation wizard. */
    onInstantiate: (text: string) => void;
}

/**
 * Binds description and title live from the editor draft; inline classes use their title
 * and an empty description. Instantiation replaces the description, so templates must include
 * `${flowNodeDescription}` to retain existing text. Copy is disabled because the result goes
 * directly to the editor. Reopening remounts the panel and reloads the template.
 */
export const TemplateInstantiationPanel: React.FC<TemplateInstantiationPanelProps> = ({
    path, inline, onInstantiate,
}) => {
    const client = useWorkerClient();
    const { title, body } = useFlowNodeEditing();
    const [fileTemplate, setFileTemplate] = useState<TemplateCollectionV0 | null>(null);

    const template = inline ? inline.template : fileTemplate;
    const boundTitle = inline ? inline.title : title;
    const boundBody = inline ? '' : body;

    // Ignore stale reads after a different template is opened.
    const reading = useRef<string | null>(null);

    // The client may change identity each render; only template changes should trigger reads.
    const workerClient = useRef(client);
    workerClient.current = client;
    useEffect(() => {
        if (inline) return;
        reading.current = path ?? null;
        setFileTemplate(null);
        if (!path) return;
        loadFlowNodeTemplate(workerClient.current, path)
            .catch(() => null)
            .then(loaded => { if (reading.current === path) setFileTemplate(loaded); });
    }, [inline, path]);

    const bound = useMemo((): KiaoElHeap => ({
        [DESCRIPTION_VARIABLE]: { type: 'text', value: boundBody },
        [TITLE_VARIABLE]: { type: 'text', value: boundTitle },
    }), [boundBody, boundTitle]);

    if (!template) return <Spin />;
    return (
        <TemplateInstantiation
            template={template}
            bound={bound}
            onInstantiate={onInstantiate}
            copyDisabled
        />
    );
};
