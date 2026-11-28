import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Alert, Button, Modal } from 'antd';

interface ConfirmationOptions {
    title: string;
    description?: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    width?: number;
    onConfirm: () => void | Promise<unknown>;
}

interface ConfirmationDialogProps extends ConfirmationOptions {
    open: boolean;
    onCancel: () => void;
    afterClose?: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
    title, description, confirmText = 'Delete', cancelText = 'Cancel', danger = true, width,
    open, onConfirm, onCancel, afterClose,
}) => {
    // The footer can still receive clicks during the closing animation.
    const visible = useRef(open);
    visible.current = open;
    const submitting = useRef(false);
    const cancelButton = useRef<React.ElementRef<typeof Button>>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();

    const submit = async () => {
        if (!visible.current || submitting.current) return;
        submitting.current = true;
        setPending(true);
        setError(undefined);
        try {
            await onConfirm();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            submitting.current = false;
            setPending(false);
        }
    };

    const cancel = () => {
        if (!visible.current || submitting.current) return;
        visible.current = false;
        setError(undefined);
        onCancel();
    };

    return (
        <Modal
            open={open}
            title={title}
            width={width}
            centered
            destroyOnHidden
            closable={false}
            maskClosable={false}
            keyboard={!pending}
            onCancel={cancel}
            afterOpenChange={visible => { if (visible) cancelButton.current?.focus(); }}
            afterClose={afterClose}
            footer={<>
                <Button ref={cancelButton} disabled={pending} onClick={cancel}>{cancelText}</Button>
                <Button type="primary" danger={danger} loading={pending} disabled={pending} onClick={submit}>
                    {confirmText}
                </Button>
            </>}
        >
            {description}
            {error !== undefined && <Alert type="error" showIcon title={error} />}
        </Modal>
    );
};

type Confirm = (options: ConfirmationOptions) => void;

const ConfirmationContext = createContext<Confirm | null>(null);

export const ConfirmationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [requests, setRequests] = useState<ConfirmationOptions[]>([]);
    const [closing, setClosing] = useState(false);
    const confirm = useCallback<Confirm>(options => {
        setRequests(current => [...current, options]);
    }, []);
    const request = requests[0];

    return (
        <ConfirmationContext.Provider value={confirm}>
            {children}
            {request && (
                <ConfirmationDialog
                    {...request}
                    open={!closing}
                    onConfirm={async () => { await request.onConfirm(); setClosing(true); }}
                    onCancel={() => setClosing(true)}
                    afterClose={() => {
                        setRequests(current => current.slice(1));
                        setClosing(false);
                    }}
                />
            )}
        </ConfirmationContext.Provider>
    );
};

export const useConfirmation = (): Confirm => {
    const confirm = useContext(ConfirmationContext);
    if (!confirm) throw new Error('useConfirmation requires a ConfirmationProvider');
    return confirm;
};
