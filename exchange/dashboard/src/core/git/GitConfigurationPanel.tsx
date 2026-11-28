import React, { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Spin } from 'antd';
import type { GitIdentity } from 'kiao-worker';
import { useWorkerClient } from '../files/service/ui';

export const GitConfigurationPanel: React.FC = () => {
    const client = useWorkerClient();
    const [form] = Form.useForm<GitIdentity>();
    const [identity, setIdentity] = useState<GitIdentity | null>(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        let current = true;
        client.gitIdentity().then(
            value => { if (current) setIdentity(value); },
            () => { if (current) setError('Could not load Git configuration.'); },
        );
        return () => { current = false; };
    }, [client]);

    const save = async (values: GitIdentity) => {
        setSaving(true);
        setSaved(false);
        setError('');
        try {
            form.setFieldsValue(await client.saveGitIdentity(values));
            setSaved(true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not save Git configuration.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="git-configuration">
            <p>This identity applies to Git commands run by KIAO and its agents for this store.</p>
            {error && <Alert type="error" showIcon title={error} />}
            {identity ? (
                <Form form={form} layout="vertical" initialValues={identity} disabled={saving}
                    onFinish={save} onValuesChange={() => setSaved(false)}>
                    <Form.Item name="name" label="Author name" rules={[{ required: true, whitespace: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="email" label="Author email" rules={[{ required: true, whitespace: true }]}>
                        <Input inputMode="email" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={saving}>Save</Button>
                    {saved && <span className="git-configuration-saved" role="status">Saved</span>}
                </Form>
            ) : !error && <Spin />}
        </div>
    );
};
