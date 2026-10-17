import React, { useEffect, useState } from 'react';
import { Form, Input, Modal, Select, Switch } from 'antd';
import { type ActionDescriptor, type ActionParam } from 'kiao-worker';

export interface ActionParamsPrompt {
    action: ActionDescriptor;
    path: string;
}

interface Props {
    prompt: ActionParamsPrompt | null;
    onConfirm: (params: Record<string, unknown>) => void;
    onCancel: () => void;
}

/**
 * Collects the parameters an action declared, from the declaration alone.
 *
 * There is one form for every action that will ever exist, because the point of declaring
 * parameters in the manifest is that adding an action needs no code here. That is also why the
 * type vocabulary is short: an enum, a string, a flag. Anything an action cannot express with
 * those belongs in the owning service, not in a richer form language.
 */
export const ActionParamsModal: React.FC<Props> = ({ prompt, onConfirm, onCancel }) => {
    const params = prompt?.action.params ?? [];
    const [values, setValues] = useState<Record<string, unknown>>({});

    useEffect(() => {
        if (!prompt) return;
        setValues(Object.fromEntries(params.map(p => [p.name, defaultFor(p)])));
        // The defaults belong to the action being opened; re-seed whenever that changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prompt]);

    return (
        <Modal
            title={prompt?.action.label ?? ''}
            open={prompt !== null}
            onOk={() => onConfirm(values)}
            onCancel={onCancel}
            okText="Run"
            destroyOnHidden
        >
            <Form layout="vertical">
                {params.map(param => (
                    <Form.Item key={param.name} label={param.label || param.name}>
                        <ParamField
                            param={param}
                            value={values[param.name]}
                            onChange={value => setValues(prev => ({ ...prev, [param.name]: value }))}
                        />
                    </Form.Item>
                ))}
            </Form>
        </Modal>
    );
};

const ParamField: React.FC<{
    param: ActionParam;
    value: unknown;
    onChange: (value: unknown) => void;
}> = ({ param, value, onChange }) => {
    switch (param.type) {
        case 'enum':
            return (
                <Select
                    value={value as string | undefined}
                    onChange={onChange}
                    options={(param.values ?? []).map(v => ({ value: v, label: v }))}
                    data-testid={`action-param-${param.name}`}
                />
            );
        case 'boolean':
            return <Switch checked={Boolean(value)} onChange={onChange} />;
        default:
            return (
                <Input
                    value={(value as string | undefined) ?? ''}
                    onChange={e => onChange(e.target.value)}
                    data-testid={`action-param-${param.name}`}
                />
            );
    }
};

const defaultFor = (param: ActionParam): unknown => {
    if (param.default !== undefined) return param.default;
    if (param.type === 'enum') return param.values?.[0];
    if (param.type === 'boolean') return false;
    return '';
};
