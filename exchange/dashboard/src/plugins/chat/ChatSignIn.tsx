import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Spin, message } from 'antd';
import { CopyOutlined, LinkOutlined, LoginOutlined } from '@ant-design/icons';
import type { HarnessLoginOffer } from 'kiao-worker';
import { WorkerError } from 'kiao-worker';
import { useWorkerClient } from '@kiao-dashboard-core';

/** How often the dialog asks whether the approval has landed while it waits. */
export const DEVICE_POLL_MS = 2000;

type View = 'device' | 'key';
/** `starting` asks the CLI for its page; `waiting` polls for the approval; `failed` offers another. */
type DeviceStep = 'starting' | 'waiting' | 'failed';

/** Signs one harness in from the usage panel: the device flow first — a page to open, a code to confirm. */
export const ChatSignIn: React.FC<{
    harness: string;
    label: string;
    login: HarnessLoginOffer;
}> = ({ harness, label, login }) => {
    const workerClient = useWorkerClient();
    // Held in a ref: the poll below must not restart because a render higher up rebuilt the client.
    const client = useRef(workerClient);
    client.current = workerClient;
    const hasDevice = login.methods.includes('device');
    const hasKey = login.methods.includes('api-key');

    const [open, setOpen] = useState(false);
    const [view, setView] = useState<View>('device');
    const [step, setStep] = useState<DeviceStep>('starting');
    const [url, setUrl] = useState('');
    const [userCode, setUserCode] = useState('');
    const [key, setKey] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const startDevice = async () => {
        setStep('starting');
        setError('');
        setUrl('');
        setUserCode('');
        try {
            const result = await client.current.startHarnessDeviceLogin(harness);
            if (!result.ok || !result.url) {
                setError(result.message || 'The service returned no sign-in page.');
                setStep('failed');
                return;
            }
            setUrl(result.url);
            setUserCode(result.userCode || '');
            setStep('waiting');
        } catch (e) {
            setError(failureText(e));
            setStep('failed');
        }
    };

    useEffect(() => {
        if (!open || view !== 'device' || step !== 'waiting') return;
        const poll = async () => {
            let status;
            try {
                status = await client.current.getHarnessDeviceLoginStatus(harness);
            } catch (e) {
                if (e instanceof WorkerError && (e.response.status === 409 || e.response.status === 404)) {
                    setError(e.response.status === 409
                        ? 'The sign-in ended before the approval landed.'
                        : 'Sign-in from here is switched off on this service.');
                    setStep('failed');
                }
                return;
            }
            if (status.pending) return;
            if (status.ok) {
                message.success(status.message || 'Signed in.');
                close(false);
                return;
            }
            setError(status.message || 'The approval did not land.');
            setStep('failed');
        };
        const timer = setInterval(() => void poll(), DEVICE_POLL_MS);
        return () => clearInterval(timer);
    });


    const close = (abandon = true) => {
        if (abandon && view === 'device' && (step === 'starting' || step === 'waiting')) {
            client.current.cancelHarnessDeviceLogin(harness).catch(() => undefined);
        }
        setOpen(false);
        setView(hasDevice ? 'device' : 'key');
        setStep('starting');
        setUrl('');
        setUserCode('');
        setKey('');
        setSubmitting(false);
        setError('');
    };

    const openDialog = () => {
        setView(hasDevice ? 'device' : 'key');
        setOpen(true);
        if (hasDevice) void startDevice();
    };


    const showKey = () => {
        if (step === 'starting' || step === 'waiting') {
            client.current.cancelHarnessDeviceLogin(harness).catch(() => undefined);
        }
        setStep('starting');
        setUrl('');
        setUserCode('');
        setError('');
        setView('key');
    };

    const showDevice = () => {
        setKey('');
        setError('');
        setView('device');
        void startDevice();
    };

    const copyText = async (text: string, what: string) => {
        try {
            await navigator.clipboard.writeText(text);
            message.success(`${what} copied`);
        } catch {
            message.error(`Could not copy the ${what.toLowerCase()}`);
        }
    };

    const submitKey = async () => {
        const value = key.trim();
        if (!value || submitting) return;
        setSubmitting(true);
        setError('');
        try {
            const result = await client.current.submitHarnessApiKey(harness, value);
            if (!result.ok) {
                setError(result.message || 'The key was refused.');
                return;
            }
            message.success(result.message || 'Signed in.');
            close(false);
        } catch (e) {
            setError(failureText(e));
        } finally {
            setSubmitting(false);
        }
    };

    if (!login.enabled) {
        return (
            <span className="chat-login-hint">
                Sign-in from here is switched off. Run <code>{login.hostCommand}</code> on the host.
            </span>
        );
    }

    return (
        <>
            <Button
                size="small"
                icon={<LoginOutlined />}
                onClick={openDialog}
                aria-label={`Log in to ${label}`}
            >
                Login
            </Button>

            <Modal
                title={`Log in to ${label}`}
                open={open}
                onCancel={() => close()}
                maskClosable={false}
                footer={footerFor(view, step, {
                    close, submitKey, startDevice,
                    canSubmitKey: !!key.trim(),
                    submitting,
                })}
            >
                {view === 'device' ? (
                    <div className="chat-login-steps">
                        {step === 'starting' && (
                            <div className="chat-login-waiting">
                                <Spin size="small" /> <span>Asking the CLI for a sign-in page…</span>
                            </div>
                        )}

                        {step === 'waiting' && (
                            <>
                                <ol>
                                    <li>Open the sign-in page and sign in.</li>
                                    <li>Enter or confirm the code shown below, then approve the request.</li>
                                </ol>
                                <div className="chat-login-link-row">
                                    <Button
                                        type="primary"
                                        icon={<LinkOutlined />}
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Open the sign-in page
                                    </Button>
                                    <Button
                                        icon={<CopyOutlined />}
                                        onClick={() => void copyText(url, 'Link')}
                                        aria-label="Copy the sign-in link"
                                    />
                                </div>
                                {userCode && (
                                    <div className="chat-login-link-row">
                                        <code className="chat-login-text">{userCode}</code>
                                        <Button
                                            icon={<CopyOutlined />}
                                            onClick={() => void copyText(userCode, 'Code')}
                                            aria-label="Copy the sign-in code"
                                        />
                                    </div>
                                )}
                                <div className="chat-login-waiting">
                                    <Spin size="small" /> <span>Waiting for approval…</span>
                                </div>
                            </>
                        )}

                        {step === 'failed' && (
                            <Alert
                                type="error"
                                showIcon
                                title="Sign-in failed"
                                description={error || 'The CLI refused the sign-in.'}
                            />
                        )}

                        {hasKey && (
                            <div>
                                <Button type="link" size="small" onClick={showKey}>
                                    Use an API key instead
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="chat-login-steps">
                        <p className="chat-login-text">
                            Paste an API key for {label}. It is stored with the {label} CLI on the
                            server, so its conversations sign in as whoever the key belongs to.
                        </p>
                        <Input.Password
                            value={key}
                            onChange={e => setKey(e.target.value)}
                            onPressEnter={submitKey}
                            placeholder="Paste the API key"
                            disabled={submitting}
                            autoFocus
                        />
                        {error && (
                            <Alert type="error" showIcon title="Sign-in failed" description={error} />
                        )}
                        {hasDevice && (
                            <div>
                                <Button type="link" size="small" onClick={showDevice}>
                                    Back to the {label} sign-in
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </>
    );
};

/** A 404 is the deployment withdrawing the endpoints after the offer was read — worth a sentence of. */
const failureText = (e: unknown): string => {
    if (e instanceof WorkerError && e.response.status === 404) {
        return 'Sign-in from here is switched off on this service.';
    }
    return e instanceof Error ? e.message : String(e);
};

/** The dialog's buttons: one action per state, so there is never a live button that cannot work. */
const footerFor = (
    view: View,
    step: DeviceStep,
    actions: {
        close: () => void;
        submitKey: () => void;
        startDevice: () => void;
        canSubmitKey: boolean;
        submitting: boolean;
    },
): React.ReactNode => {
    const cancel = <Button key="cancel" onClick={() => actions.close()}>Cancel</Button>;
    if (view === 'key') {
        return [
            cancel,
            <Button
                key="submit"
                type="primary"
                onClick={actions.submitKey}
                loading={actions.submitting}
                disabled={!actions.canSubmitKey}
            >
                Log in
            </Button>,
        ];
    }
    if (step === 'failed') {
        return [cancel, <Button key="retry" type="primary" onClick={actions.startDevice}>Start again</Button>];
    }
    return [cancel];
};
