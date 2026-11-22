import React, { useId, useMemo, useState } from 'react';
import { Alert, Button, Input, Modal, Select, Space } from 'antd';
import { CheckCircleOutlined, EditOutlined, ExperimentOutlined, FileTextOutlined, ForkOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Tooltip } from '@kiao-dashboard-core';
import { useMarkdownDocument } from './MarkdownDocument';
import { readMarkdownMetadata, type MarkdownRole, type MarkdownStatus } from './markdownMetadata';

const statusOptions: { value: MarkdownStatus; label: string; icon: React.ReactNode }[] = [
    { value: 'DRAFT', label: 'Draft — being prepared for publication', icon: <EditOutlined /> },
    { value: 'EXPERIMENTAL', label: 'Experimental — neither a source nor intended for publication', icon: <ExperimentOutlined /> },
    { value: 'APPROVED', label: 'Approved — validated and published', icon: <CheckCircleOutlined /> },
];
const roleOptions: { value: MarkdownRole; label: string; icon: React.ReactNode }[] = [
    { value: 'PRIMARY_SOURCE', label: 'Primary source — edited directly', icon: <FileTextOutlined /> },
    { value: 'DERIVED', label: 'Derived — generated from other sources', icon: <ForkOutlined /> },
];

export const MarkdownMetadataControls: React.FC = () => {
    const { content, loading, onChange } = useMarkdownDocument();
    const metadata = useMemo(() => readMarkdownMetadata(content), [content]);
    const [provenanceOpen, setProvenanceOpen] = useState(false);
    const provenanceId = useId();
    const disabled = loading || !!metadata.error;
    const statusOption = statusOptions.find(option => option.value === metadata.status);
    const roleOption = roleOptions.find(option => option.value === metadata.role);

    return (
        <>
            <Tooltip title={metadata.error}>
                <Space size={4}>
                    <Tooltip title={statusOption?.label ?? metadata.status ?? 'Document status: not set'}>
                        <Select<MarkdownStatus>
                            aria-label="Document status"
                            placeholder={<QuestionCircleOutlined />}
                            size="small"
                            style={{ width: 'auto' }}
                            suffixIcon={null}
                            popupMatchSelectWidth={false}
                            value={metadata.status as MarkdownStatus | undefined}
                            options={statusOptions}
                            labelRender={() => statusOption?.icon ?? <QuestionCircleOutlined />}
                            optionRender={option => <Space size={8}>{option.data.icon}{option.label}</Space>}
                            disabled={disabled}
                            onChange={status => onChange(metadata.update({ status }))}
                        />
                    </Tooltip>
                    <Tooltip title={roleOption?.label ?? metadata.role ?? 'Document role: not set'}>
                        <Select<MarkdownRole>
                            aria-label="Document role"
                            placeholder={<QuestionCircleOutlined />}
                            size="small"
                            style={{ width: 'auto' }}
                            suffixIcon={null}
                            popupMatchSelectWidth={false}
                            value={metadata.role as MarkdownRole | undefined}
                            options={roleOptions}
                            labelRender={() => roleOption?.icon ?? <QuestionCircleOutlined />}
                            optionRender={option => <Space size={8}>{option.data.icon}{option.label}</Space>}
                            disabled={disabled}
                            // Reselecting the current role opens its provenance too.
                            onSelect={role => {
                                if (role !== metadata.role) onChange(metadata.update({ role }));
                                setProvenanceOpen(true);
                            }}
                        />
                    </Tooltip>
                </Space>
            </Tooltip>
            <Modal
                title="Document provenance"
                open={provenanceOpen}
                onCancel={() => setProvenanceOpen(false)}
                footer={<Button onClick={() => setProvenanceOpen(false)}>Close</Button>}
            >
                {metadata.error && <Alert type="error" title={metadata.error} />}
                <label htmlFor={provenanceId}>Provenance description</label>
                <Input.TextArea
                    id={provenanceId}
                    value={metadata.provenance}
                    onChange={event => onChange(metadata.update({ provenance: event.target.value }))}
                    disabled={disabled}
                    autoSize={{ minRows: 4, maxRows: 12 }}
                    placeholder="Describe the document's sources and how it was produced."
                />
                <p>Changes are saved automatically.</p>
            </Modal>
        </>
    );
};
