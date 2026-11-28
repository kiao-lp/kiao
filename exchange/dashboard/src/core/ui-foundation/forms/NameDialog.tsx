import React, { useEffect, useId, useRef, useState } from 'react';
import { Alert, Input, Modal, Typography, type InputRef } from 'antd';
import { VoiceInput } from '../voice-input';

interface NameDialogProps {
    open: boolean;
    title: string;
    label: string;
    okText: string;
    description?: string;
    placeholder?: string;
    initialName?: string | (() => string);
    selection?: { start: number; end: number };
    voice?: boolean;
    allowEmpty?: boolean;
    busy?: boolean;
    inputTestId?: string;
    /** Return false when the caller has already reported a failure. */
    onSubmit: (name: string) => void | boolean | Promise<void | boolean>;
    onClose: () => void;
}

export const NameDialog: React.FC<NameDialogProps> = ({
    open, title, label, okText, description, placeholder, initialName = '', selection, voice,
    allowEmpty = false, busy = false, inputTestId, onSubmit, onClose,
}) => {
    const input = useRef<InputRef>(null);
    const submitting = useRef(false);
    const descriptionId = useId();
    const [draft, setDraft] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();

    useEffect(() => {
        if (!open) return;
        setDraft(typeof initialName === 'function' ? initialName() : initialName);
        setError(undefined);
    }, [open, initialName]);

    const name = draft.trim();
    const locked = busy || pending;
    const valid = allowEmpty || name !== '';
    const submit = async () => {
        if (!open || !valid || busy || submitting.current) return;
        submitting.current = true;
        setPending(true);
        setError(undefined);
        try {
            if (await onSubmit(name) !== false) onClose();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            submitting.current = false;
            setPending(false);
        }
    };

    const NameInput = voice ? VoiceInput : Input;
    return (
        <Modal
            open={open}
            title={title}
            okText={okText}
            centered
            destroyOnHidden
            closable={!locked}
            keyboard={!locked}
            maskClosable={!locked}
            confirmLoading={locked}
            okButtonProps={{ disabled: locked || !valid, 'aria-label': okText, 'aria-busy': locked }}
            cancelButtonProps={{ disabled: locked }}
            styles={{ body: { display: 'grid', gap: 8 } }}
            onOk={submit}
            onCancel={() => { if (open && !busy && !submitting.current) onClose(); }}
            afterOpenChange={visible => {
                if (!visible) return;
                input.current?.focus({ preventScroll: true });
                if (selection) input.current?.setSelectionRange(selection.start, selection.end);
                else input.current?.select();
            }}
        >
            {description && <Typography.Text id={descriptionId}>{description}</Typography.Text>}
            <NameInput
                ref={input}
                aria-label={label}
                aria-describedby={description ? descriptionId : undefined}
                placeholder={placeholder}
                data-testid={inputTestId}
                value={draft}
                readOnly={locked}
                onChange={event => { setDraft(event.target.value); setError(undefined); }}
                onPressEnter={event => { event.preventDefault(); void submit(); }}
            />
            {error !== undefined && <Alert type="error" showIcon title={error} />}
        </Modal>
    );
};
