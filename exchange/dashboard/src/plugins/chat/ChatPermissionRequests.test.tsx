import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, afterEach } from 'vitest';

import { ChatPermissionRequests } from './ChatPermissionRequests';
import type { PermissionRequest } from './chatMessages';

const editRequest: PermissionRequest = {
    requestId: 'req-1',
    toolName: 'Edit',
    description: 'notes.md',
    input: '{\n  "file_path": "notes.md",\n  "new_string": "b"\n}',
};

const renderCards = (requests: PermissionRequest[]) => {
    const onDecide = vi.fn();
    render(<ChatPermissionRequests requests={requests} onDecide={onDecide} />);
    return onDecide;
};

/** Walks the fake clock forward a whole number of seconds. */
const advanceSeconds = (seconds: number) => {
    act(() => { vi.advanceTimersByTime(seconds * 1000); });
};

/** A card the service will allow in `seconds` — what `manualLive` puts on a request. */
const countedDown = (seconds: number): PermissionRequest =>
    ({ ...editRequest, decideAt: Date.now() + seconds * 1000 });

afterEach(() => {
    vi.useRealTimers();
});

describe('ChatPermissionRequests', () => {
    it('renders nothing when no request is pending', () => {
        const { container } = render(<ChatPermissionRequests requests={[]} onDecide={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows the tool, its subject and the input the decision is about', () => {
        renderCards([editRequest]);

        expect(screen.getByText('Edit')).toBeInTheDocument();
        expect(screen.getByText('notes.md')).toBeInTheDocument();
        expect(screen.getByText(/"new_string": "b"/)).toBeInTheDocument();
    });

    it('says the tool and its subject on one line, the way the sentence reads', () => {
        renderCards([editRequest]);

        expect(screen.getByText(/wants to use/)).toHaveTextContent('The turn wants to use Edit: notes.md');
    });

    it('reports allow and deny for the request that was clicked', () => {
        const onDecide = renderCards([editRequest, { requestId: 'req-2', toolName: 'Bash' }]);

        fireEvent.click(screen.getAllByText('Allow')[1]);
        fireEvent.click(screen.getAllByText('Deny')[0]);

        expect(onDecide).toHaveBeenNthCalledWith(1, 'req-2', 'allow');
        expect(onDecide).toHaveBeenNthCalledWith(2, 'req-1', 'deny');
    });

    it('renders a request that carries no description or input', () => {
        renderCards([{ requestId: 'req-3', toolName: 'WebSearch' }]);

        expect(screen.getByText('WebSearch')).toBeInTheDocument();
        expect(screen.getByText('Allow')).toBeInTheDocument();
    });
});

describe('ChatPermissionRequests — Manual Live', () => {
    it('says nothing about a countdown for a card nothing will decide on its own', () => {
        vi.useFakeTimers();
        const onDecide = renderCards([editRequest]);

        advanceSeconds(15);

        expect(screen.queryByText(/Allowing in/)).not.toBeInTheDocument();
        expect(onDecide).not.toHaveBeenCalled();
    });

    it('counts the service’s own deadline down, so the decision is never a surprise', () => {
        vi.useFakeTimers();
        renderCards([countedDown(10)]);

        expect(screen.getByText('Allowing in 10s')).toBeInTheDocument();
        advanceSeconds(1);
        expect(screen.getByText('Allowing in 9s')).toBeInTheDocument();
    });

    it('never decides anything itself: the count runs out and the service answers', () => {
        vi.useFakeTimers();
        const onDecide = renderCards([countedDown(10)]);

        advanceSeconds(30);

        expect(onDecide).not.toHaveBeenCalled();
        expect(screen.getByText('Allowing…')).toBeInTheDocument();
    });

    it('counts each card down to its own deadline', () => {
        vi.useFakeTimers();
        renderCards([countedDown(10), { ...editRequest, requestId: 'req-2', toolName: 'Bash', decideAt: Date.now() + 4000 }]);

        expect(screen.getByText('Allowing in 10s')).toBeInTheDocument();
        expect(screen.getByText('Allowing in 4s')).toBeInTheDocument();
    });

    it('stops counting a card the user has answered', () => {
        vi.useFakeTimers();
        const onDecide = renderCards([countedDown(10)]);

        fireEvent.click(screen.getByText('Deny'));
        // Denying does not unmount the card — `permission_resolved` does — so without this the panel
        advanceSeconds(1);

        expect(screen.queryByText(/Allowing/)).not.toBeInTheDocument();
        expect(onDecide).toHaveBeenCalledTimes(1);
        expect(onDecide).toHaveBeenCalledWith('req-1', 'deny');
    });
});
