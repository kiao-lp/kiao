import React, { useEffect, useState } from 'react';
import { Button } from 'antd';
import { CheckOutlined, CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { PermissionRequest } from './chatMessages';

/**
 * Seconds left before the service allows this card on its own, or null when nothing is counting.
 *
 * **The clock is read rather than run.** `decideAt` is the moment worker will allow the call —
 * it is the service's decision, taken whether or not this tab is open — so what happens here is a
 * display of somebody else's deadline: a card left alone shows it running out and is then taken off
 * screen by the `permission_resolved` that answers it. A tab that was closed and reopened, or a
 * second tab watching the same turn, counts down to the same instant because it is the same instant.
 *
 * It stops at zero rather than firing anything. The decision has already been made by then, and the
 * card stands at "Allowing…" for the moment it takes the frame to come back.
 */
const useCountdown = (decideAt: number | undefined): number | null => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!decideAt) return;
        // Ticked rather than computed once: the seconds have to be seen to run down, and the card may
        // sit under a streaming turn for the whole of them.
        const tick = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(tick);
    }, [decideAt]);

    if (!decideAt) return null;
    return Math.max(0, Math.ceil((decideAt - now) / 1000));
};

/**
 * One tool call the turn is waiting on. It makes no progress until this is answered, so the card
 * shows what would run — tool, subject, and the input the service sent — with the two answers.
 *
 * In `manualLive` it also shows the seconds until the service answers it with Allow. That count is
 * the whole difference between the two manual modes, so it is stated where the buttons are rather
 * than left to be inferred from a bar quietly emptying — and the point of showing it is Deny: the
 * mode promises that every call is *seen*, with time to refuse it.
 */
const PermissionCard: React.FC<{
    request: PermissionRequest;
    onDecide: (requestId: string, behavior: 'allow' | 'deny') => void;
}> = ({ request, onDecide }) => {
    // A card is not taken off screen by being answered — `permission_resolved` is what does that, and
    // it comes back over the socket. So the count is stopped here: without it, denying a call and
    // watching the panel go on saying it will be allowed in three seconds is what the user sees.
    const [decided, setDecided] = useState(false);
    const decide = (behavior: 'allow' | 'deny') => {
        setDecided(true);
        onDecide(request.requestId, behavior);
    };
    const remaining = useCountdown(decided ? undefined : request.decideAt);

    return (
        <div className="chat-permission-card">
            {/* Tool and subject are one sentence — "The turn wants to use Bash: read the pdf service
                headers" — so they are one line of text that wraps only when it has to, rather than
                two blocks that always cost two lines of a sidebar. It does not name the agent: only
                an agent that asks ever raises one of these, and the conversation says which that is
                on the bar below. */}
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
            {/* Both buttons say what they do, so neither carries a tooltip. Denying is not fatal: the
                model is told and carries on without that call. */}
            <div className="chat-permission-actions">
                {remaining !== null && (
                    <span
                        className="chat-permission-countdown"
                        // A number that changes on its own is worth announcing once rather than ten
                        // times: what matters is that this card will be allowed, not each tick.
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

/**
 * The pending permission requests, one card each. Renders nothing when there are none, which is
 * every turn in `bypassPermissions` mode.
 *
 * Which cards are counted down is the request's own business — a `manualLive` one carries the
 * deadline the service will decide at — so nothing here has to be told the turn's mode.
 */
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
