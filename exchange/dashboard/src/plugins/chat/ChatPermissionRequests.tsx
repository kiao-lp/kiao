import React, { useEffect, useState } from 'react';
import { Button } from 'antd';
import { CheckOutlined, CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { PermissionRequest } from './chatMessages';

/** Seconds left before the service allows this card on its own, or null when nothing is counting.. */
const useCountdown = (decideAt: number | undefined): number | null => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!decideAt) return;
        const tick = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(tick);
    }, [decideAt]);

    if (!decideAt) return null;
    return Math.max(0, Math.ceil((decideAt - now) / 1000));
};

/** One tool call the turn is waiting on. */
const PermissionCard: React.FC<{
    request: PermissionRequest;
    onDecide: (requestId: string, behavior: 'allow' | 'deny') => void;
}> = ({ request, onDecide }) => {
    const [decided, setDecided] = useState(false);
    const decide = (behavior: 'allow' | 'deny') => {
        setDecided(true);
        onDecide(request.requestId, behavior);
    };
    const remaining = useCountdown(decided ? undefined : request.decideAt);

    return (
        <div className="chat-permission-card">
            <div className="chat-permission-head">
                <SafetyCertificateOutlined className="chat-permission-icon" />
                <span className="chat-permission-title">
                    The turn wants to use <strong>{request.toolName}</strong>
                    {request.description && (
                        <>{': '}<span className="chat-permission-subject">{request.description}</span></>
                    )}
                </span>
            </div>
            {request.input && (
                <pre className="chat-permission-input">{request.input}</pre>
            )}
            <div className="chat-permission-actions">
                {remaining !== null && (
                    <span
                        className="chat-permission-countdown"
                        aria-label={`Allowing automatically in ${remaining} seconds`}
                    >
                        {remaining > 0 ? `Allowing in ${remaining}s` : 'Allowing…'}
                    </span>
                )}
                <Button
                    type="primary"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={() => decide('allow')}
                >
                    Allow
                </Button>
                <Button
                    danger
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => decide('deny')}
                >
                    Deny
                </Button>
            </div>
        </div>
    );
};

/** The pending permission requests, one card each. */
export const ChatPermissionRequests: React.FC<{
    requests: PermissionRequest[];
    onDecide: (requestId: string, behavior: 'allow' | 'deny') => void;
}> = ({ requests, onDecide }) => {
    if (requests.length === 0) return null;
    return (
        <div className="chat-permission-requests">
            {requests.map(r => (
                <PermissionCard key={r.requestId} request={r} onDecide={onDecide} />
            ))}
        </div>
    );
};
