import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from 'src/test/render';

import { ChatMessageList } from './ChatMessageList';
import type { ChatMessage } from './chatMessages';

// ── What the panel shows of a turn ────────────────────────────────────────────
//
// The chat is where a conversation is audited, so what is pinned here is that nothing is dropped and
// nothing is moved: every block appears, in the order the model produced it, whether the turn is
// streaming or was read back from the transcript a week later.

// What the list does with the scroll position is useStickToBottom's, and is tested there.
const stick = {
    ref: () => { /* nothing to follow here */ },
    onScroll: () => { /* nothing to follow here */ },
    follow: () => { /* nothing to follow here */ },
};

// A reply goes through the CMS's own markdown renderer, which resolves an image against the store —
// hence a files client, the one piece of the app the list cannot be rendered without.
const workerClient = { getDownloadUrl: (path: string) => `/api/files/download/${path}` };

const show = (
    messages: ChatMessage[],
    folder = 'units',
    onFork?: (message: ChatMessage) => void,
    conversationId: string | null = null,
) =>
    render(
        <ChatMessageList
            messages={messages} stick={stick} folder={folder}
            conversationId={conversationId} onFork={onFork}
        />,
        { workerClient: workerClient as any },
    );

/**
 * The bubble's blocks, one per element, in the order they are laid out — which is the thing under
 * test, so they are joined with a visible separator rather than run together as `textContent` would.
 */
const bubbleBlocks = (container: HTMLElement) =>
    [...(container.querySelector('.chat-message-bubble')?.children ?? [])]
        .map(child => (child.textContent ?? '').replace(/\s+/g, ' ').trim())
        .join(' | ');

const ordered: ChatMessage = {
    id: 'm1',
    role: 'assistant',
    content: '',
    blocks: [
        { kind: 'text', text: 'Looking.' },
        { kind: 'thinking', text: 'the file is probably under units/' },
        { kind: 'tool_use', name: 'Read', summary: 'Read(units/a.md)', detail: '{\n  "file_path": "units/a.md"\n}' },
        { kind: 'text', text: 'Found it.' },
    ],
};

describe('ChatMessageList — a reply recorded in order', () => {
    it('shows every block where it happened', () => {
        const { container } = show([ordered]);

        // The tool call is *between* the two paragraphs. The flat rendering this replaced hoisted
        // every chip above all the text, so a call made after a paragraph was displayed before it.
        expect(bubbleBlocks(container)).toBe(
            'Looking. | 💭 Thought · 33 characters | 🔧 Read(units/a.md) | Found it.');
    });

    it('keeps thinking collapsed until it is asked for', () => {
        show([ordered]);
        const toggle = screen.getByRole('button', { name: /Thought/ });

        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText(/probably under units/)).toBeNull();

        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText(/probably under units/)).toBeTruthy();
    });

    it('opens a tool chip onto the whole input the summary cuts short', () => {
        show([ordered]);
        const chip = screen.getByRole('button', { name: /Read/ });

        expect(screen.queryByText(/"file_path"/)).toBeNull();

        fireEvent.click(chip);

        expect(screen.getByText(/"file_path": "units\/a.md"/)).toBeTruthy();
    });

    it('marks where the model thought even though the CLI sends no reasoning', () => {
        vi.useFakeTimers();
        try {
            show([{ id: 'm2', role: 'assistant', content: '', blocks: [{ kind: 'thinking', text: '' }] }]);

            // The normal case, not an edge one: a `thinking` block comes back carrying only a signature.
            // Dropping it for having no text would take the shape of the turn off the screen — where the
            // model stopped to reason is itself part of the account.
            const toggle = screen.getByRole('button', { name: /Thought/ });
            expect(toggle).toBeDisabled();
            // The explanation rides the tooltip, which opens on a still second — a disabled button
            // carries no native tooltip of its own, so this hover is the only way to read it.
            fireEvent.mouseOver(toggle);
            act(() => { vi.advanceTimersByTime(1000); });
            expect(document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden)')?.textContent)
                .toMatch(/does not disclose/);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('ChatMessageList — a message recorded before blocks existed', () => {
    it('renders as it always did, chips above the text', () => {
        const { container } = show([{
            id: 'old',
            role: 'assistant',
            content: 'the whole reply',
            toolUses: [{ name: 'Bash', summary: 'Bash(git status)' }],
        }]);

        // Its order was never captured, so drawing one would assert something untrue about a
        // conversation the user can still read.
        expect(bubbleBlocks(container)).toBe('🔧 Bash(git status) | the whole reply');
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('leaves a user prompt and a notice alone', () => {
        const { container } = show([
            { id: 'u', role: 'user', content: 'read CLAUDE.md' },
            { id: 'n', role: 'notice', content: 'The Claude session has expired.' },
        ]);

        expect(within(container).getByText('read CLAUDE.md')).toBeTruthy();
        expect(container.querySelector('.chat-message--notice')?.textContent)
            .toContain('The Claude session has expired.');
    });
});

// ── What a reader can magnify ─────────────────────────────────────────────────
//
// The banner's zoom slider works on whatever carries `data-zoomable` (cms-core/zoom). Which element
// wears it is a judgement about reading rather than about markup, and it is the judgement asserted
// here: the unit is the passage in front of the reader, not the turn that holds it.

describe('ChatMessageList — a message said into a running turn', () => {
    const prompt: ChatMessage = { id: 'm1', role: 'user', content: 'count to a hundred' };
    const between: ChatMessage = { id: 'm2', role: 'user', content: 'stop at ten', between: true };

    it('is the user speaking, and says that it landed inside the turn', () => {
        const { container } = show([prompt, between]);

        const bubbles = container.querySelectorAll('.chat-message');
        // Same author, same side: a between is a user message, and dressing it as anything else
        // would misattribute what somebody actually said.
        expect(bubbles[1].className).toContain('chat-message--user');
        expect(bubbles[1].className).toContain('chat-message--between');
        expect(screen.getByText('stop at ten')).toBeInTheDocument();
        // The caption is the whole point: months later, it is what explains why the reply under it
        // changes direction.
        expect(within(bubbles[1] as HTMLElement).getByText(/said mid-turn/i)).toBeInTheDocument();
    });

    it('leaves an ordinary prompt unmarked', () => {
        const { container } = show([prompt]);

        expect(container.querySelector('.chat-message--between')).toBeNull();
        expect(screen.queryByText(/said mid-turn/i)).not.toBeInTheDocument();
    });
});

describe('ChatMessageList — what a Ctrl-click magnifies', () => {
    const targets = (container: HTMLElement) =>
        [...container.querySelectorAll('[data-zoomable]')]
            .map(element => (element.textContent ?? '').replace(/\s+/g, ' ').trim());

    it('offers each run of prose on its own, not the turn around it', () => {
        const { container } = show([ordered]);

        // Two runs either side of a tool call, and neither the bubble nor the chips join them: a
        // reader magnifying "Found it." must not drag the earlier paragraph and the tool chip along.
        expect(targets(container)).toEqual(['Looking.', 'Found it.']);
        expect(container.querySelector('.chat-message-bubble')!.hasAttribute('data-zoomable')).toBe(false);
    });

    it('offers a prompt and an old flat reply whole, each being one block already', () => {
        const { container } = show([
            { id: 'u', role: 'user', content: 'read CLAUDE.md' },
            { id: 'old', role: 'assistant', content: 'the whole reply' },
        ]);

        expect(targets(container)).toEqual(['read CLAUDE.md', 'the whole reply']);
    });
});

// ── What the CMS renderer adds to a reply ─────────────────────────────────────
//
// A reply is rendered by the same renderer as every document of the store, and the model is briefed
// on the two consequences (see `driver_claude.go`). Both are pinned here because both are silent
// failures: a diagram would come back as a wall of source, and a link to a file would 404 on the
// mount point instead of opening it.

describe('ChatMessageList — a reply rendered by the CMS renderer', () => {
    // The mount point the app was built with; vitest does not carry vite's `base` into the tests.
    beforeEach(() => { vi.stubEnv('BASE_URL', '/dashboard/'); });
    afterEach(() => { vi.unstubAllEnvs(); });

    const reply = (markdown: string) =>
        show([{ id: 'r', role: 'assistant', content: '', blocks: [{ kind: 'text', text: markdown }] }]);

    it('draws a mermaid fence as a diagram rather than printing its source', () => {
        const { container } = reply('```mermaid\ngraph TD;\n  A-->B;\n```');

        expect(container.querySelector('.mermaid')?.getAttribute('data-mermaid-source'))
            .toContain('A-->B');
    });

    it('draws a plantuml fence as a diagram rather than printing its source', () => {
        const { container } = reply('```plantuml\n@startuml\nA -> B\n@enduml\n```');

        expect(container.querySelector('img[data-plantuml-source]')?.getAttribute('src'))
            .toMatch(/\/svg\//);
    });

    it('resolves a relative image against the conversation folder, not the browsed one', async () => {
        // A path the model writes is written from the folder it was started in — `units` here —
        // while the file browser, whose folder every other document resolves against, may well be
        // showing something else entirely.
        const { container } = reply('![a shot](pictures/shot.png)');

        await waitFor(() => expect(container.querySelector('img')?.getAttribute('src'))
            .toBe('/api/files/download/units/pictures/shot.png'));
    });

    it('resolves a link to a store file onto the app mount point', () => {
        // Written bare by the model, `/units/abc/cadre.md`, and displayed against wherever the app
        // is served — which is what makes it openable from the conversation in one click.
        const { container } = reply('See [cadre.md](/units/abc/cadre.md).');

        expect(container.querySelector('a')?.getAttribute('href'))
            .toBe('/dashboard/units/abc/cadre.md');
    });
});

// ── Where the conversation branches ───────────────────────────────────────────
//
// Forking is asked of a message rather than of the conversation, because *where* is the whole of
// what a user is choosing when they fork one. What is pinned here is which messages can answer that
// question — a prompt of the user's own, recorded, and settled — and that the action carries the
// message rather than the conversation, since the panel cannot branch at a point it was not told.

describe('ChatMessageList — forking from a message', () => {
    const prompt = (over: Partial<ChatMessage> = {}): ChatMessage =>
        ({ id: 'm-user', role: 'user', content: 'Rewrite the README', ...over });

    const forkButtons = () => screen.queryAllByLabelText('Fork conversation from here');

    it('offers the fork on a prompt, and hands the message back to whoever asked', () => {
        const onFork = vi.fn();
        show([prompt()], 'units', onFork);

        const buttons = forkButtons();
        expect(buttons).toHaveLength(1);
        fireEvent.click(buttons[0]);
        // The message and not just its id: the panel puts the text back in the box, because forking
        // a prompt is asking it again.
        expect(onFork).toHaveBeenCalledWith(expect.objectContaining({ id: 'm-user', content: 'Rewrite the README' }));
    });

    it('offers it on nothing a fork could not branch at', () => {
        const onFork = vi.fn();
        show([
            // The reply is not a question anyone can ask again, and neither is the service's own line.
            { id: 'm-reply', role: 'assistant', content: 'Done.' },
            { id: 'm-notice', role: 'notice', content: 'Forked from “Alpha”.' },
            // Said into a running turn: there is no turn boundary at it to branch on.
            prompt({ id: 'm-between', between: true }),
            // Refused, so the service has no record of it — a branch point that does not exist.
            prompt({ id: 'm-pending', pending: true }),
            // Still being answered.
            prompt({ id: 'm-live', isStreaming: true }),
        ], 'units', onFork);

        expect(forkButtons()).toHaveLength(0);
    });

    it('offers it nowhere at all when the panel is not taking forks', () => {
        // What the pane does while a turn is running: the service refuses to fork a conversation it
        // is still writing, and an action that is always refused is better not offered.
        show([prompt()]);

        expect(forkButtons()).toHaveLength(0);
    });
});

describe('ChatMessageList — where the conversation is kept', () => {
    const storageLine = () => document.querySelector('.chat-conversation-storage');

    it('heads the transcript with the storage path of the conversation', () => {
        const { container } = show(
            [{ id: 'm-user', role: 'user', content: 'Hello' }],
            'units', undefined, 'conv-1',
        );

        const line = storageLine();
        expect(line).toHaveTextContent('.kiao-config/conversations/conv-1');
        // The first line of the scroll, above the messages rather than pinned above them: it is
        // scrolled past like any other line once read.
        expect(container.querySelector('.chat-messages-area')!.firstElementChild).toBe(line);
    });

    it('heads the empty chat too, where the id is all there is yet', () => {
        show([], 'units', undefined, 'conv-1');

        expect(storageLine()).toHaveTextContent('.kiao-config/conversations/conv-1');
    });

    it('names no storage where no conversation is selected', () => {
        show([{ id: 'm-user', role: 'user', content: 'Hello' }]);

        expect(storageLine()).toBeNull();
    });
});

describe('ChatMessageList — a delegation', () => {
    const delegated: ChatMessage = {
        id: 'm3',
        role: 'assistant',
        content: '',
        blocks: [
            { kind: 'text', text: 'Looking.' },
            {
                kind: 'subagent',
                text: 'child did things',
                subagent: {
                    role: 'researcher',
                    objective: 'find the bug',
                    status: 'completed',
                    result: 'it was the cache',
                    blocks: [
                        { kind: 'thinking', text: 'where would I hide' },
                        { kind: 'tool_use', name: 'Read', summary: 'Read(x)' },
                        { kind: 'text', text: 'Found it.' },
                    ],
                },
            },
        ],
    };

    it('says who was asked and to do what, with the transcript collapsed', () => {
        show([delegated]);
        const toggle = screen.getByRole('button', { name: /Subagent/ });

        expect(toggle).toHaveTextContent('researcher');
        expect(toggle).toHaveTextContent('completed');
        expect(toggle).toHaveTextContent('1 thought');
        expect(toggle).toHaveTextContent('1 tool');
        expect(screen.getByText('find the bug')).toBeTruthy();
        // Collapsed: what the child thought and did is one click away, not on screen.
        expect(screen.queryByText(/where would I hide/)).toBeNull();
        expect(screen.queryByText('Found it.')).toBeNull();
    });

    it('opens onto what the child thought and did, in the order it did it', () => {
        const { container } = show([delegated]);
        fireEvent.click(screen.getByRole('button', { name: /Subagent/ }));

        expect(screen.getByText('it was the cache')).toBeTruthy();
        const body = container.querySelector('.chat-subagent-body')!;
        const order = [...body.children]
            .map(child => (child.textContent ?? '').replace(/\s+/g, ' ').trim())
            .join(' | ');
        expect(order).toBe('it was the cache | 💭 Thought · 18 characters | 🔧 Read(x) | Found it.');
    });

    it('says where the transcript was cut short', () => {
        const cut: ChatMessage = {
            ...delegated,
            blocks: [{
                kind: 'subagent',
                text: 'child did things',
                subagent: { truncated: true, blocks: [{ kind: 'text', text: 'the end' }] },
            }],
        };
        show([cut]);
        fireEvent.click(screen.getByRole('button', { name: /Subagent/ }));

        expect(screen.getByText(/most recent of a longer transcript/)).toBeTruthy();
    });

    it('offers nothing to open where the delegation holds nothing', () => {
        const bare: ChatMessage = {
            ...delegated,
            blocks: [{
                kind: 'subagent',
                text: 'child did things',
                subagent: { status: 'running', blocks: [] },
            }],
        };
        show([bare]);

        expect(screen.getByRole('button', { name: /Subagent/ })).toBeDisabled();
        expect(screen.getByText('child did things')).toBeTruthy();
    });
});
