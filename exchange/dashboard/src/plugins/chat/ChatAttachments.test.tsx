import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from 'src/test/render';
import type { AgentAttachment } from 'kiao-worker';
import { agentOptions } from 'src/test/agents';

// ── What the pane is given ────────────────────────────────────────────────────
//
// One conversation, already selected, and a files client that answers the upload. What is under
// test is the road a file takes from the clipboard to the `prompt` frame — so `send` and
// `uploadAgentAttachment` are the two things watched, and everything else is stood in for.

const state = await vi.hoisted(async () => {
    const { createConversationMock } = await import('./test/mocks');
    return { ...createConversationMock(), upload: vi.fn(), getBlob: vi.fn() };
});

vi.mock('@cms-core', async () => ({
    // A file dragged out of the tree onto the box is markdownLinkDrop.test's subject, not this
    // one's: here the handlers only have to be handlers.
    markdownLinkDropHandlers: () => ({}),
    useFileBrowsingPersistenceContext: () => ({ currentPath: 'units', currentFile: null }),
    // The error notice links a signed-out failure to the Usage tab; here the tab switch only has
    // to be callable.
    useToolBars: () => ({ showTab: () => undefined }),
    useWorkerClient: () => ({
        uploadAgentAttachment: state.upload,
        getAgentAttachmentBlob: state.getBlob,
    }),
    ConfiguredMarkdown: ({ children }: { children: string }) => <div>{children}</div>,
    zoomable: { 'data-zoomable': '' },
    Tooltip: (await import('antd')).Tooltip,
}));

vi.mock('./useChatConversation', () => ({
    useChatConversation: () => ({
        conversation: null,
        messages: state.messages,
        running: state.running,
        permissionRequests: [], questionRequests: [],
        lastError: null, loading: false,
        send: state.send, sendBetween: vi.fn(), stop: vi.fn(),
        decidePermission: vi.fn(), answerQuestions: vi.fn(),
    }),
}));

// The board's run: nothing is playing in these tests, so the pane asks nothing when it sends.
vi.mock('./ChatChainRuns-ctx', () => ({
    useChatChainRuns: () => ({
        runs: [], play: vi.fn(), stop: vi.fn(), resume: vi.fn(), restart: vi.fn(), forget: vi.fn(),
    }),
}));

import { ChatConversationPane } from './ChatConversationPane';
import { filesFromDrop, filesFromPaste, formatBytes } from './ChatAttachments';

const stored = (over: Partial<AgentAttachment> = {}): AgentAttachment => ({
    id: 'att-1756100000000-abcd-shot.png', name: 'shot.png', size: 8, mediaType: 'image/png', ...over,
});

const pngFile = (name = 'shot.png') => new File(['PNGBYTES'], name, { type: 'image/png' });

/** One agent with one of everything: the pane is asked about attachments, not about catalogues. */
const TEST_AGENT = agentOptions({
    permissionModes: [{ value: 'manual', label: 'Manual' }],
});

const paneWith = (restoredPrompt: { paneKey: string; text: string; attachments: string[] } | null) => (
    <ChatConversationPane
        paneKey="main"
        conversationId="conv-1"
        conversation={null}
        currentPath="units"
        agents={[TEST_AGENT]}
        optionsFor={() => TEST_AGENT}
        restoredPrompt={restoredPrompt}
    />
);

const renderPane = () => render(paneWith(null));

const box = () => screen.getByPlaceholderText(/Continue the conversation/) as HTMLTextAreaElement;
// antd puts the icon's own aria-label into the accessible name, so it is "send Send" rather than
// "Send". No other button in the pane is named anything like it.
const sendButton = () => screen.getByRole('button', { name: /send/i });

/**
 * A paste or a drop event carrying files. jsdom builds neither DataTransfer nor a ClipboardEvent
 * with one, so the shape both handlers actually read is supplied directly.
 */
const transfer = (files: File[], text = '') => ({
    files,
    types: files.length ? ['Files'] : [],
    getData: () => text,
});

beforeEach(() => {
    state.send.mockReset();
    state.running = false;
    state.messages = [];
    state.upload.mockReset().mockResolvedValue(stored());
    state.getBlob.mockReset().mockResolvedValue(new Blob(['PNGBYTES'], { type: 'image/png' }));
    // jsdom has none of the three. The transcript scrolls itself on every new message, and the
    // chips are drawn from an object URL.
    Element.prototype.scrollIntoView = vi.fn();
    global.URL.createObjectURL = vi.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = vi.fn();
});

describe('attaching a file to a message', () => {
    it('uploads a pasted screenshot and sends its id with the prompt', async () => {
        renderPane();
        fireEvent.paste(box(), { clipboardData: transfer([pngFile()]) });

        // The chip is there before the upload answers, so a paste is visibly a paste.
        expect(await screen.findByText('shot.png')).toBeInTheDocument();
        await waitFor(() => expect(state.upload).toHaveBeenCalledTimes(1));

        fireEvent.change(box(), { target: { value: 'what is this?' } });
        await waitFor(() => expect(sendButton()).not.toBeDisabled());
        fireEvent.click(sendButton());

        expect(state.send).toHaveBeenCalledWith(
            'what is this?',
            expect.objectContaining({ attachments: ['att-1756100000000-abcd-shot.png'] }),
        );
    });

    it('takes a file dropped on the column', async () => {
        renderPane();
        const pane = document.querySelector('.chat-pane') as HTMLElement;
        fireEvent.dragOver(pane, { dataTransfer: transfer([pngFile('diagram.png')]) });
        expect(document.querySelector('.chat-pane--drag-over')).toBeTruthy();

        fireEvent.drop(pane, { dataTransfer: transfer([pngFile('diagram.png')]) });
        await waitFor(() => expect(state.upload).toHaveBeenCalledTimes(1));
        expect(document.querySelector('.chat-pane--drag-over')).toBeFalsy();
    });

    it('takes a file from the picker', async () => {
        renderPane();
        const input = document.querySelector('.chat-attachment-input') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [pngFile('notes.pdf')] } });
        await waitFor(() => expect(state.upload).toHaveBeenCalledTimes(1));
    });

    // An attachment with nothing typed is a message: dropping a screenshot into a chat is itself
    // the question. The service appends the note naming the file, so nothing empty reaches the CLI.
    it('sends an attachment with no text at all', async () => {
        renderPane();
        expect(sendButton()).toBeDisabled();

        fireEvent.paste(box(), { clipboardData: transfer([pngFile()]) });
        await waitFor(() => expect(sendButton()).not.toBeDisabled());
        fireEvent.click(sendButton());

        expect(state.send).toHaveBeenCalledWith('', expect.objectContaining({
            attachments: ['att-1756100000000-abcd-shot.png'],
        }));
    });

    // The id is what a prompt names, and it does not exist until the upload answers. Sending before
    // then would send the sentence without the file it is about.
    it('will not send while an upload is still in flight', async () => {
        let finish: (a: AgentAttachment) => void = () => {};
        state.upload.mockReturnValue(new Promise<AgentAttachment>(resolve => { finish = resolve; }));
        renderPane();

        fireEvent.change(box(), { target: { value: 'look' } });
        fireEvent.paste(box(), { clipboardData: transfer([pngFile()]) });
        await waitFor(() => expect(sendButton()).toBeDisabled());

        finish(stored());
        await waitFor(() => expect(sendButton()).not.toBeDisabled());
        fireEvent.click(sendButton());
        expect(state.send).toHaveBeenCalledWith('look', expect.objectContaining({
            attachments: ['att-1756100000000-abcd-shot.png'],
        }));
    });

    it('empties the strip once the message is on its way', async () => {
        renderPane();
        fireEvent.paste(box(), { clipboardData: transfer([pngFile()]) });
        await waitFor(() => expect(sendButton()).not.toBeDisabled());
        fireEvent.click(sendButton());

        await waitFor(() => expect(screen.queryByText('shot.png')).not.toBeInTheDocument());
    });

    it('lets an attachment be taken back out before it is sent', async () => {
        renderPane();
        fireEvent.paste(box(), { clipboardData: transfer([pngFile()]) });
        await screen.findByText('shot.png');

        fireEvent.click(screen.getByRole('button', { name: /Remove shot.png/ }));
        await waitFor(() => expect(screen.queryByText('shot.png')).not.toBeInTheDocument());
        // Nothing typed and nothing attached is nothing to send.
        expect(sendButton()).toBeDisabled();
    });

    // An upload that failed has no id. The chip stays — the user has to see that the file did not
    // make it — and the message goes without it rather than being blocked forever.
    it('marks an upload that failed and does not send its id', async () => {
        state.upload.mockRejectedValue(new Error('disk full'));
        renderPane();
        fireEvent.paste(box(), { clipboardData: transfer([pngFile()]) });

        await waitFor(() => expect(document.querySelector('.chat-attachment-chip--error')).toBeTruthy());
        fireEvent.change(box(), { target: { value: 'never mind' } });
        fireEvent.click(sendButton());
        expect(state.send).toHaveBeenCalledWith('never mind', expect.objectContaining({ attachments: [] }));
    });

    // The name a chip shows is the one the service stored, which is the one the model was told.
    it('shows the stored name rather than the one that was uploaded', async () => {
        state.upload.mockResolvedValue(stored({ name: 'Mon-cran.png' }));
        renderPane();
        fireEvent.paste(box(), { clipboardData: transfer([pngFile('Mon Écran.png')]) });
        expect(await screen.findByText('Mon-cran.png')).toBeInTheDocument();
    });
});

describe('a prompt the transport gave up on', () => {
    // The text comes back to the box; the files it named are still on the server, so their chips
    // come back too. Without this the second attempt goes without the screenshot the first was
    // about — which is the one failure neither the user nor the model can detect.
    it('puts back the chips for the attachments it named', async () => {
        const { rerender } = renderPane();
        fireEvent.paste(box(), { clipboardData: transfer([pngFile()]) });
        await waitFor(() => expect(sendButton()).not.toBeDisabled());
        fireEvent.click(sendButton());
        await waitFor(() => expect(screen.queryByText('shot.png')).not.toBeInTheDocument());

        rerender(paneWith({
            paneKey: 'main', text: 'what is this?',
            attachments: ['att-1756100000000-abcd-shot.png'],
        }));

        expect(await screen.findByText('shot.png')).toBeInTheDocument();
        expect(box().value).toBe('what is this?');

        // And the second attempt names the same file.
        state.send.mockReset();
        fireEvent.click(sendButton());
        expect(state.send).toHaveBeenCalledWith('what is this?', expect.objectContaining({
            attachments: ['att-1756100000000-abcd-shot.png'],
        }));
    });

    // Only a reload produces one, and a reload has emptied the box anyway — so it is skipped rather
    // than drawn as a chip the pane knows nothing about.
    it('ignores an id this pane never uploaded', async () => {
        const { rerender } = renderPane();
        rerender(paneWith({ paneKey: 'main', text: 'hello', attachments: ['att-1756100000000-ffff-x.png'] }));
        await waitFor(() => expect(box().value).toBe('hello'));
        expect(document.querySelector('.chat-attachment-chip')).toBeFalsy();
    });
});

describe('reading a clipboard', () => {
    // Copying an image gives a clipboard of files alone. Copying from a word processor gives files
    // *and* the text — and there the text is what the user meant to paste.
    it('takes files only when there is no text beside them', () => {
        const file = pngFile();
        expect(filesFromPaste(transfer([file]) as unknown as DataTransfer)).toEqual([file]);
        expect(filesFromPaste(transfer([file], 'some text') as unknown as DataTransfer)).toEqual([]);
        expect(filesFromPaste(transfer([]) as unknown as DataTransfer)).toEqual([]);
        expect(filesFromPaste(null)).toEqual([]);
    });

    // A drop has no such ambiguity: dropping a file is only ever dropping a file.
    it('takes every dropped file, text or not', () => {
        const file = pngFile();
        expect(filesFromDrop(transfer([file], 'a name') as unknown as DataTransfer)).toEqual([file]);
        expect(filesFromDrop(null)).toEqual([]);
    });
});

describe('what a sent message carried', () => {
    it('shows an attached image back inside the bubble', async () => {
        state.messages = [{
            id: 'm1', role: 'user', content: 'what is this?',
            attachments: [stored()],
        }];
        renderPane();
        const img = await screen.findByAltText('shot.png');
        expect(img).toHaveAttribute('src', 'blob:preview');
        expect(state.getBlob).toHaveBeenCalledWith('att-1756100000000-abcd-shot.png');
    });

    it('names a document without trying to draw it', async () => {
        state.messages = [{
            id: 'm1', role: 'user', content: 'read this',
            attachments: [stored({ id: 'att-1756100000000-abcd-notes.pdf', name: 'notes.pdf', mediaType: 'application/pdf' })],
        }];
        renderPane();
        expect(await screen.findByText('notes.pdf')).toBeInTheDocument();
        expect(state.getBlob).not.toHaveBeenCalled();
    });

    // An attachment is swept after a month while the transcript that names it is kept. The message
    // did carry it, so the line stays — struck through rather than quietly dropped.
    it('marks an attachment the server no longer has', async () => {
        state.getBlob.mockRejectedValue(new Error('404'));
        state.messages = [{ id: 'm1', role: 'user', content: 'this', attachments: [stored()] }];
        renderPane();
        await waitFor(() => expect(document.querySelector('.chat-attachment-sent--gone')).toBeTruthy());
    });
});

describe('formatBytes', () => {
    it('keeps a chip-sized label at every scale', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(2048)).toBe('2 kB');
        expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    });
});
