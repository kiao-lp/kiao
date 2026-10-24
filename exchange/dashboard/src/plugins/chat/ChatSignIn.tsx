import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Spin, message } from 'antd';
import { CopyOutlined, LinkOutlined, LoginOutlined } from '@ant-design/icons';
import type { AgentLoginOffer } from 'kiao-worker';
import { WorkerError } from 'kiao-worker';
import { useWorkerClient, Tooltip } from '@cms-core';

/** How often the dialog asks whether the approval has landed while it waits. */
export const DEVICE_POLL_MS = 2000;

type View = 'device' | 'key';
/** `starting` asks the CLI for its page; `waiting` polls for the approval; `failed` offers another start. */
type DeviceStep = 'starting' | 'waiting' | 'failed';

/**
 * Signs one agent in from the usage panel: the device flow first — a page to open, a code to
 * confirm, a wait for the approval — with the API key as the alternative for whoever already holds
 * one. Which of the two the dialog offers is the service's say, read off the offer.
 *
 * The device wait is polled, not pushed: while the CLI is parked the dialog asks every two seconds
 * whether the approval has landed. A failed read changes nothing — it is the *service* that could
 * not be reached, which says nothing about the wait — so only an answer ends it. Closing the
 * dialog abandons a wait still in flight, which kills the process parked on the server; a finished
 * one needs no killing, since reading it consumed it.
 */
export const ChatSignIn: React.FC<{
    agent: string;
    label: string;
    login: AgentLoginOffer;
}> = ({ agent, label, login }) => {
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
            const result = await client.current.startAgentDeviceLogin(agent);
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

    // The wait, polled. Only an answer ends it: pending asks again in two seconds, a finished wait
    // succeeds or fails the dialog, and a 409 — nothing in flight any more — is a wait that ended
    // elsewhere. Anything else the read met is the service being unreachable, which says nothing
    // about the wait and is left for the next poll.
    useEffect(() => {
        if (!open || view !== 'device' || step !== 'waiting') return;
        const poll = async () => {
            let status;
            try {
                status = await client.current.getAgentDeviceLoginStatus(agent);
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

    /**
     * Closes the dialog. A device wait still in flight is abandoned with it — best effort, since
     * a failed cancel changes nothing the user can act on. A finished wait needs no killing,
     * since reading it consumed it.
     */
    const close = (abandon = true) => {
        if (abandon && view === 'device' && (step === 'starting' || step === 'waiting')) {
            client.current.cancelAgentDeviceLogin(agent).catch(() => undefined);
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

    /** Switching to the key abandons a device wait still in flight: the two are alternatives. */
    const showKey = () => {
        if (step === 'starting' || step === 'waiting') {
            client.current.cancelAgentDeviceLogin(agent).catch(() => undefined);
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
            const result = await client.current.submitAgentApiKey(agent, value);
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
                                    <Tooltip title="Copy the link, for a browser that blocked the new tab">
                                        <Button
                                            icon={<CopyOutlined />}
                                            onClick={() => void copyText(url, 'Link')}
                                            aria-label="Copy the sign-in link"
                                        />
                                    </Tooltip>
                                </div>
                                {userCode && (
                                    <div className="chat-login-link-row">
                                        <code className="chat-login-text">{userCode}</code>
                                        <Tooltip title="Copy the code">
                                            <Button
                                                icon={<CopyOutlined />}
                                                onClick={() => void copyText(userCode, 'Code')}
                                                aria-label="Copy the sign-in code"
                                            />
                                        </Tooltip>
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

/**
 * A 404 is the deployment withdrawing the endpoints after the offer was read — worth a sentence of
 * its own rather than the transport's "Not Found".
 */
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
