import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from 'src/test/render';
import type { HarnessAttachment } from 'kiao-worker';
import { harnessOptions } from 'src/test/harnesses';


const state = await vi.hoisted(async () => {
    const { createConversationMock } = await import('./test/mocks');
    return { ...createConversationMock(), upload: vi.fn(), getBlob: vi.fn() };
});

vi.mock('@kiao-dashboard-core', async () => ({
    useStickToBottom: (await import('../../core/ui-foundation/scrolling/useStickToBottom')).useStickToBottom,
    // one's: here the handlers only have to be handlers.
    markdownLinkDropHandlers: () => ({}),
    useFileBrowsingPersistenceContext: () => ({ currentPath: 'units', currentFile: null }),
    // The error notice links a signed-out failure to the Usage tab; here the tab switch only has
    useToolBars: () => ({ showTab: () => undefined }),
    useWorkerClient: () => ({
        uploadHarnessAttachment: state.upload,
        getHarnessAttachmentBlob: state.getBlob,
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

vi.mock('./ChatChainRuns-ctx', () => ({
    useChatChainRuns: () => ({
        runs: [], play: vi.fn(), stop: vi.fn(), resume: vi.fn(), restart: vi.fn(), forget: vi.fn(),
    }),
}));

import { ChatConversationPane } from './ChatConversationPane';
import { filesFromDrop, filesFromPaste, formatBytes } from './ChatAttachments';

const stored = (over: Partial<HarnessAttachment> = {}): HarnessAttachment => ({
    id: 'att-1756100000000-abcd-shot.png', name: 'shot.png', size: 8, mediaType: 'image/png', ...over,
});

const pngFile = (name = 'shot.png') => new File(['PNGBYTES'], name, { type: 'image/png' });

/** One harness with one of everything: the pane is asked about attachments, not about catalogues. */
const TEST_AGENT = harnessOptions({
    permissionModes: [{ value: 'manual', label: 'Manual' }],
});

const paneWith = (restoredPrompt: { paneKey: string; text: string; attachments: string[] } | null) => (
    <ChatConversationPane
        paneKey="main"
        conversationId="conv-1"
        conversation={null}
        currentPath="units"
        harnesses={[TEST_AGENT]}
        optionsFor={() => TEST_AGENT}
        restoredPrompt={restoredPrompt}
    />
);

const renderPane = () => render(paneWith(null));

const box = () => screen.getByPlaceholderText(/Continue the conversation/) as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: /send/i });

/** A paste or a drop event carrying files. jsdom builds neither DataTransfer nor a ClipboardEvent with. */
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
    Element.prototype.scrollIntoView = vi.fn();
    global.URL.createObjectURL = vi.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = vi.fn();
});

describe('attaching a file to a message', () => {
    it('uploads a pasted screenshot and sends its id with the prompt', async () => {
        renderPane();
        fireEvent.paste(box(), { clipboardData: transfer([pngFile()]) });

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

    // then would send the sentence without the file it is about.
    it('will not send while an upload is still in flight', async () => {
        let finish: (a: HarnessAttachment) => void = () => {};
        state.upload.mockReturnValue(new Promise<HarnessAttachment>(resolve => { finish = resolve; }));
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
        expect(sendButton()).toBeDisabled();
    });

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

    it('shows the stored name rather than the one that was uploaded', async () => {
        state.upload.mockResolvedValue(stored({ name: 'Mon-cran.png' }));
        renderPane();
        fireEvent.paste(box(), { clipboardData: transfer([pngFile('Mon Écran.png')]) });
        expect(await screen.findByText('Mon-cran.png')).toBeInTheDocument();
    });
});

describe('a prompt the transport gave up on', () => {
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

        state.send.mockReset();
        fireEvent.click(sendButton());
        expect(state.send).toHaveBeenCalledWith('what is this?', expect.objectContaining({
            attachments: ['att-1756100000000-abcd-shot.png'],
        }));
    });

    // Only a reload produces one, and a reload has emptied the box anyway — so it is skipped rather
    it('ignores an id this pane never uploaded', async () => {
        const { rerender } = renderPane();
        rerender(paneWith({ paneKey: 'main', text: 'hello', attachments: ['att-1756100000000-ffff-x.png'] }));
        await waitFor(() => expect(box().value).toBe('hello'));
        expect(document.querySelector('.chat-attachment-chip')).toBeFalsy();
    });
});

describe('reading a clipboard', () => {
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
