import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Spin } from 'antd';
import { useWorkerClient } from '@kiao-dashboard-core';
import { KiaoElHeap, TemplateCollectionV0 } from '@kiao-dashboard-kit/template-lang';
import { TemplateInstantiation } from '@kiao-dashboard-kit/template-fields';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { DESCRIPTION_VARIABLE, loadFlowNodeTemplate, TITLE_VARIABLE } from '../flowNodeTemplates';

interface TemplateInstantiationPanelProps {
    path?: string;
    inline?: { template: TemplateCollectionV0; title: string };

    onInstantiate: (text: string) => void;
}

/**
 * Binds description and title live from the editor draft; inline classes use their title and an empty.
 * Instantiation replaces the description, so templates must include `${flowNodeDescription}` to.
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
