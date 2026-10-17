import React, { useState } from 'react';
import { Alert, Button, Input, Modal, Spin, message } from 'antd';
import { CopyOutlined, LinkOutlined, LoginOutlined } from '@ant-design/icons';
import type { AgentAuthStatus } from 'kiao-worker';
import { useWorkerClient, Tooltip } from '@cms-core';

/**
 * `starting` and `submitting` are the two waits; `code` is the one the user drives, with the CLI
 * parked on its stdin on the server. `failed` keeps the dialog open on a refusal — the service
 * discards the session when a code is refused, so the way out of it is a fresh start, not a
 * second paste.
 */
type Step = 'idle' | 'starting' | 'code' | 'submitting' | 'failed';

/**
 * Signs the server-side Claude CLI in from the browser, so a signed-out host does not require a
 * shell on the machine.
 *
 * The CLI prints an authorisation URL and then waits for the code that page shows to be pasted
 * back, which is the shape of this dialog: open the link, authorise, paste. Nothing is rendered
 * while the host is signed in (or its status unknown) — this is a call to action or nothing.
 */
export const ChatLoginPanel: React.FC<{
    status: AgentAuthStatus | null;
    onSignedIn: () => void;
}> = ({ status, onSignedIn }) => {
    const workerClient = useWorkerClient();
    const [step, setStep] = useState<Step>('idle');
    const [url, setUrl] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState('');

    const start = async () => {
        setStep('starting');
        setError('');
        setUrl('');
        setCode('');
        try {
            const result = await workerClient.startAgentLogin();
            if (!result.ok || !result.url) {
                setError(result.message || 'The service returned no sign-in link.');
                setStep('failed');
                return;
            }
            setUrl(result.url);
            setStep('code');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setStep('failed');
        }
    };

    const submit = async () => {
        const value = code.trim();
        if (!value) return;
        setStep('submitting');
        setError('');
        try {
            const result = await workerClient.submitAgentLoginCode(value);
            if (!result.ok) {
                setError(result.message || 'The code was refused.');
                setStep('failed');
                return;
            }
            message.success(result.message || 'Signed in.');
            close(false);
            onSignedIn();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setStep('failed');
        }
    };

    /**
     * Closes the dialog. Abandoning a started sign-in kills the process parked on the server, so it
     * does not sit on its stdin until the session times out — best effort, since a failed cancel
     * changes nothing the user can act on.
     */
    const close = (abandon = true) => {
        if (abandon && (step === 'code' || step === 'failed')) {
            workerClient.cancelAgentLogin().catch(() => undefined);
        }
        setStep('idle');
        setUrl('');
        setCode('');
        setError('');
    };

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(url);
            message.success('Link copied');
        } catch {
            message.error('Could not copy the link');
        }
    };

    if (!status || status.loggedIn) return null;

    return (
        <>
            <div className="chat-login-banner">
                <span className="chat-login-text">Claude Code is signed out on the server.</span>
                {status.loginEnabled ? (
                    <Button size="small" type="primary" icon={<LoginOutlined />} onClick={start}>
                        Sign in
                    </Button>
                ) : (
                    <span className="chat-login-hint">
                        Run <code>claude auth login</code> on the host.
                    </span>
                )}
            </div>

            <Modal
                title="Sign in to Claude Code"
                open={step !== 'idle'}
                onCancel={() => close()}
                maskClosable={false}
                footer={footerFor(step, { close, start, submit, canSubmit: !!code.trim() })}
            >
                {step === 'starting' && (
                    <div className="chat-login-waiting">
                        <Spin size="small" /> <span>Asking the CLI for a sign-in link…</span>
                    </div>
                )}

                {(step === 'code' || step === 'submitting') && (
                    <div className="chat-login-steps">
                        <ol>
                            <li>Open the authorisation page and approve the request.</li>
                            <li>Copy the code it shows, and paste it below.</li>
                        </ol>
                        <div className="chat-login-link-row">
                            <Button
                                type="primary"
                                icon={<LinkOutlined />}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Open the authorisation page
                            </Button>
                            <Tooltip title="Copy the link, for a browser that blocked the new tab">
                                <Button icon={<CopyOutlined />} onClick={copyLink} aria-label="Copy the sign-in link" />
                            </Tooltip>
                        </div>
                        <Input
                            value={code}
                            onChange={e => setCode(e.target.value)}
                            onPressEnter={submit}
                            placeholder="Paste the code here"
                            disabled={step === 'submitting'}
                            autoFocus
                        />
                        {step === 'submitting' && (
                            <div className="chat-login-waiting">
                                <Spin size="small" /> <span>Exchanging the code…</span>
                            </div>
                        )}
                    </div>
                )}

                {step === 'failed' && (
                    <Alert
                        type="error"
                        showIcon
                        title="Sign-in failed"
                        description={error || 'The CLI refused the sign-in.'}
                    />
                )}
            </Modal>
        </>
    );
};

/** The dialog's buttons: one action per step, so there is never a live button that cannot work. */
const footerFor = (
    step: Step,
    actions: { close: () => void; start: () => void; submit: () => void; canSubmit: boolean },
): React.ReactNode => {
    const cancel = <Button key="cancel" onClick={actions.close}>Cancel</Button>;
    switch (step) {
        case 'failed':
            return [cancel, <Button key="retry" type="primary" onClick={actions.start}>Start again</Button>];
        case 'code':
        case 'submitting':
            return [
                cancel,
                <Button
                    key="submit"
                    type="primary"
                    onClick={actions.submit}
                    loading={step === 'submitting'}
                    disabled={!actions.canSubmit}
                >
                    Validate
                </Button>,
            ];
        default:
            return [cancel];
    }
};
