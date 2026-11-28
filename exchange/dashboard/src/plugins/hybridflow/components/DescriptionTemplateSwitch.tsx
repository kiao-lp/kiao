import React, { useEffect, useState } from 'react';
import { Button, Modal, Switch, Tooltip } from 'antd';
import { serializeTempMd } from '@kiao-dashboard-kit/template-lang';
import { flowNodeBodyTemplate, looksLikeDescriptionTemplate } from '../flowNodeTemplates';

export const DescriptionTemplateSwitch: React.FC<{
    body: string;
    checked: boolean;
    disabled: boolean;
    onChange: (edit: { multiPartTemplate: boolean; body?: string }) => void;
}> = ({ body, checked, disabled, onChange }) => {
    const [pendingBody, setPendingBody] = useState<string>();
    const confirming = !disabled && !checked && pendingBody === body;

    useEffect(() => {
        if (!confirming) setPendingBody(undefined);
    }, [confirming]);

    const activate = (convert: boolean) => onChange(convert
        ? { multiPartTemplate: true, body: serializeTempMd(flowNodeBodyTemplate(body, false)) }
        : { multiPartTemplate: true });

    const changeMode = (enabled: boolean) => {
        if (!enabled || !body.trim()) onChange({ multiPartTemplate: enabled });
        else if (looksLikeDescriptionTemplate(body)) setPendingBody(body);
        else activate(true);
    };

    const cancel = () => setPendingBody(undefined);
    const confirm = (convert: boolean) => {
        if (!confirming) return;
        cancel();
        activate(convert);
    };

    return (
        <>
            <Tooltip title="Multi-part template">
                <Switch size="small" aria-label="Multi-part template" checked={checked} disabled={disabled}
                    onChange={changeMode} />
            </Tooltip>
            <Modal
                open={confirming}
                title="Is the description already a multi-part template?"
                onCancel={cancel}
                footer={[
                    <Button key="cancel" onClick={cancel}>Cancel</Button>,
                    <Button key="convert" onClick={() => confirm(true)}>Put text in Root</Button>,
                    <Button key="keep" type="primary" onClick={() => confirm(false)}>Use existing template</Button>,
                ]}
            >
                The description has template headings. Use them as template sections or put the entire description in Root.
            </Modal>
        </>
    );
};
