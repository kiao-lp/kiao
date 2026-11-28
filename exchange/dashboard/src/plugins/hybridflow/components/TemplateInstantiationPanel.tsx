import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Spin } from 'antd';
import { useWorkerClient } from '@kiao-dashboard-core';
import { KiaoElHeap, TemplateCollectionV0 } from '@kiao-dashboard-kit/template-lang';
import { TemplateInstantiation } from '@kiao-dashboard-kit/template-fields';
import { useFlowNodeEditing } from '../FlowNodeEditing-ctx';
import { DESCRIPTION_VARIABLE, loadFlowNodeTemplate, TITLE_VARIABLE } from '../flowNodeTemplates';

interface TemplateInstantiationPanelProps {
    path: string;

    onInstantiate: (text: string) => void;
}

/**
 * Binds description and title live from the editor draft.
 * Use `${flowNodeDescription}` to include the existing wording in the result.
 */
export const TemplateInstantiationPanel: React.FC<TemplateInstantiationPanelProps> = ({
    path, onInstantiate,
}) => {
    const client = useWorkerClient();
    const { title, body } = useFlowNodeEditing();
    const [fileTemplate, setFileTemplate] = useState<TemplateCollectionV0 | null>(null);

    // The client may change identity each render; only template changes should trigger reads.
    const workerClient = useRef(client);
    workerClient.current = client;
    useEffect(() => {
        let active = true;
        setFileTemplate(null);
        loadFlowNodeTemplate(workerClient.current, path)
            .catch(() => null)
            .then(loaded => { if (active) setFileTemplate(loaded); });
        return () => { active = false; };
    }, [path]);

    const bound = useMemo((): KiaoElHeap => ({
        [DESCRIPTION_VARIABLE]: { type: 'text', value: body },
        [TITLE_VARIABLE]: { type: 'text', value: title },
    }), [body, title]);

    if (!fileTemplate) return <Spin />;
    return (
        <TemplateInstantiation
            template={fileTemplate}
            bound={bound}
            onInstantiate={onInstantiate}
            copyDisabled
        />
    );
};
