import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const bars = vi.hoisted(() => ({ showTab: vi.fn() }));

vi.mock('@cms-core', () => ({
    useToolBars: () => bars,
}));

import { ChatErrorNotice } from './ChatErrorNotice';

describe('ChatErrorNotice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders nothing without an error', () => {
        const { container } = render(<ChatErrorNotice error={null} onDismiss={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });

    // An ordinary refusal is the message and nothing else: there is nowhere for it to go.
    it('says a mid-turn complaint with no link', () => {
        render(
            <ChatErrorNotice
                error={{ code: 'cli_error', message: 'the stream stumbled' }}
                onDismiss={vi.fn()}
            />,
        );

        expect(screen.getByText('the stream stumbled')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /usage/i })).not.toBeInTheDocument();
    });

    // The one refusal with somewhere to go: a turn that never ran for want of credentials links to
    // the Usage tab, where that agent's Login is offered.
    it('links a signed-out failure to the Usage tab', () => {
        render(
            <ChatErrorNotice
                error={{ code: 'not_signed_in', message: 'not logged in: run /login to add an API key' }}
                onDismiss={vi.fn()}
            />,
        );

        expect(screen.getByText('not logged in: run /login to add an API key')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Open Usage to sign in' }));
        expect(bars.showTab).toHaveBeenCalledWith('chat-usage');
    });

    it('dismisses', () => {
        const onDismiss = vi.fn();
        render(
            <ChatErrorNotice error={{ code: 'cli_error', message: 'the stream stumbled' }} onDismiss={onDismiss} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
        expect(onDismiss).toHaveBeenCalled();
    });
});
