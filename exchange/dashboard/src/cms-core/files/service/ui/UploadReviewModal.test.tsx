import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ReindexResult } from 'kiao-worker';
import { UploadTree } from './folderUpload';
import { UploadReviewModal } from './UploadReviewModal';
import { UploadDecisions, buildReview } from './uploadReview';
import { GateMatcher, parseCategory } from '../../../import-gate';

// The real renderer wants the plugin list, the files client and the browsing context — none of
// which this dialog's own behaviour depends on. What is being tested here is that a Markdown
// document reaches a renderer at all rather than being shown as source, so a renderer that says so
// is the whole of what the test needs.
vi.mock('../../../markdown', () => ({
    ConfiguredMarkdown: ({ children }: { children: string }) =>
        <div data-testid="rendered-markdown">{children}</div>,
}));

const STAGING = '.kiao-uploads/u-1-abc';

const tree = (paths: string[]): UploadTree => ({
    items: paths.map(p => {
        const cut = p.lastIndexOf('/');
        return { file: new File(['body'], cut < 0 ? p : p.slice(cut + 1)), relativeDir: cut < 0 ? '' : p.slice(0, cut) };
    }),
    emptyDirs: [],
});

const converted = (...paths: string[]): ReindexResult => ({
    indexed: paths.map(p => `${STAGING}/${p}`), upToDate: 0, failed: [], truncated: false,
});

/**
 * Four files, one of each kind the reader has to tell apart: a converted document (its index is
 * Markdown), an image nothing can be read of, a note that is text already, and a second converted
 * document in a subfolder.
 */
const review = buildReview(
    STAGING, 'archive',
    tree(['rapport.pdf', 'photo.jpg', 'notes.txt', 'mail/note.eml']),
    { succeeded: 4, failed: [] },
    converted('rapport.pdf.index.md', 'mail/note.eml.index.md'));

/** A one-rule gate, so the dialog can be asked whether it ran the store's own. */
const gate: GateMatcher[] = parseCategory('secrets.json', {
    category: 'secrets', label: 'Credentials', criticality: 'critical',
    matchers: [{ label: 'AWS key', pattern: '\\bAKIA[0-9A-Z]{16}\\b' }],
});

const renderModal = (props: Partial<React.ComponentProps<typeof UploadReviewModal>> = {}) => {
    const onImport = vi.fn();
    const onCancel = vi.fn();
    const loadIndex = vi.fn(async (path: string) => `the text of ${path}`);
    render(<UploadReviewModal
        review={review} loadIndex={loadIndex} onCancel={onCancel} onImport={onImport} {...props} />);
    return { onImport, onCancel, loadIndex };
};

/** Clicks a file of the tree by its path. */
const pick = (path: string) => userEvent.click(screen.getByTestId(`upload-review-node-${path}`));

const shownText = () => screen.getByTestId('upload-review-index').textContent;

describe('UploadReviewModal', () => {
    it('shows the uploaded tree and reads an index into the text area on click', async () => {
        const { loadIndex } = renderModal();

        expect(screen.getByTestId('upload-review-node-mail')).toBeTruthy();
        expect(shownText()).toContain('Pick a file in the tree');

        await pick('rapport.pdf');
        await waitFor(() => expect(shownText()).toBe(`the text of ${STAGING}/rapport.pdf.index.md`));
        expect(loadIndex).toHaveBeenCalledWith(`${STAGING}/rapport.pdf.index.md`);
    });

    // The gate is about imported *text*, and a note somebody typed is text without anything having
    // to convert it. Reading only what was converted would wave through the one kind of file whose
    // secrets are in plain sight.
    it('reads a file that is already text, with no index in between', async () => {
        const { loadIndex } = renderModal();
        await pick('notes.txt');

        await waitFor(() => expect(shownText()).toBe(`the text of ${STAGING}/notes.txt`));
        expect(loadIndex).toHaveBeenCalledWith(`${STAGING}/notes.txt`);
    });

    // An index is Markdown, and so is half of what anybody uploads.
    it('renders Markdown as a document rather than as its source', async () => {
        renderModal();
        await pick('rapport.pdf');

        await waitFor(() => expect(screen.getByTestId('rendered-markdown')).toBeTruthy());
        expect(screen.queryByRole('mark')).toBeNull();
    });

    it('shows a text file that is not Markdown as source', async () => {
        renderModal();
        await pick('notes.txt');

        await waitFor(() => expect(shownText()).toContain('the text of'));
        expect(screen.queryByTestId('rendered-markdown')).toBeNull();
    });

    // A file with no index still opens: it is imported unless somebody says otherwise, and the pane
    // has to say so rather than look broken.
    it('says so, instead of reading, when there is nothing to read', async () => {
        const { loadIndex } = renderModal();
        await pick('photo.jpg');

        expect(shownText()).toContain('nothing to read here');
        expect(loadIndex).not.toHaveBeenCalled();
    });

    it('starts with neither radio chosen, and reports the choice in the tree', async () => {
        renderModal();
        await pick('rapport.pdf');

        const checked = () => (screen.getAllByRole('radio') as HTMLInputElement[]).filter(r => r.checked).length;
        expect(checked()).toBe(0);

        await userEvent.click(screen.getByTestId('upload-review-delete'));
        expect(checked()).toBe(1); // the probe is a real one: a click does show up here
        expect(screen.getByTestId('upload-review-node-rapport.pdf').textContent).toContain('delete');

        // And the choice is per file: the next one starts undecided too. The radios are the same
        // three elements throughout, so this is the assertion that a decision cannot leak sideways.
        await pick('mail/note.eml');
        expect(checked()).toBe(0);
    });

    // The third choice: keep what the document *says* and let the document itself go. It cannot be
    // offered without an index, since there would be nothing to put in its place.
    it('offers Import as text only for a file that was converted', async () => {
        renderModal();
        // antd puts a Radio's extra props on the input itself, so the test id is the control.
        const asText = () => screen.getByTestId('upload-review-as-text') as HTMLInputElement;

        await pick('rapport.pdf');
        expect(asText().disabled).toBe(false);

        await pick('notes.txt'); // text already, and so nothing was converted for it
        expect(asText().disabled).toBe(true);

        await pick('photo.jpg');
        expect(asText().disabled).toBe(true);
    });

    it('carries an Import as text decision out to the import', async () => {
        const { onImport } = renderModal();
        await pick('rapport.pdf');
        await userEvent.click(screen.getByTestId('upload-review-as-text'));

        expect(screen.getByTestId('upload-review-node-rapport.pdf').textContent).toContain('text');

        await userEvent.click(screen.getByTestId('upload-review-unsafe'));
        expect(onImport).toHaveBeenCalledWith({ 'rapport.pdf': 'text' }, {});
    });

    it('offers Safe import only once every readable document has been decided', async () => {
        const { onImport } = renderModal();
        const safe = () => screen.getByTestId('upload-review-safe') as HTMLButtonElement;
        expect(safe().disabled).toBe(true);

        await pick('rapport.pdf');
        await userEvent.click(screen.getByTestId('upload-review-import'));
        expect(safe().disabled).toBe(true);

        await pick('notes.txt'); // the plain note counts too, now that it is read
        await userEvent.click(screen.getByTestId('upload-review-import'));
        expect(safe().disabled).toBe(true);

        await pick('mail/note.eml');
        await userEvent.click(screen.getByTestId('upload-review-delete'));
        expect(safe().disabled).toBe(false);

        await userEvent.click(safe());
        const expected: UploadDecisions = { 'rapport.pdf': 'import', 'notes.txt': 'import', 'mail/note.eml': 'delete' };
        expect(onImport).toHaveBeenCalledWith(expected, {});
    });

    // The red one is the way past the gate, and it asks nothing: it is offered from the start, and
    // pressing it runs the same import the safe one would.
    it('offers Unsafe import from the start, and imports without confirming', async () => {
        const { onImport } = renderModal();
        const unsafe = screen.getByTestId('upload-review-unsafe') as HTMLButtonElement;
        expect(unsafe.disabled).toBe(false);

        await userEvent.click(unsafe);
        expect(onImport).toHaveBeenCalledWith({}, {});
    });

    // The store's gate is run over what the reader is shown, and the decision below is taken on
    // the result. A dialog that read the index without it would be the old one.
    it('runs the store gate over the text it shows, and steps through what it found', async () => {
        renderModal({
            matchers: gate,
            loadIndex: async () => 'ship it with AKIA1234567890123456 inside',
        });
        await pick('notes.txt');

        await waitFor(() => expect(screen.getByTestId('gate-count-critical').textContent).toBe('1 critical'));
        expect(document.querySelector('mark')?.textContent).toBe('AKIA1234567890123456');

        await userEvent.click(screen.getByTestId('gate-next'));
        expect(screen.getByTestId('gate-current').textContent).toContain('Credentials · AWS key');
    });

    // Obfuscating is a decision about what gets imported, so it survives selecting another file and
    // comes back with the import rather than living in the reader.
    it('obfuscates a finding, keeps it obfuscated, and hands the redaction to the import', async () => {
        const { onImport } = renderModal({
            matchers: gate,
            loadIndex: async () => 'ship it with AKIA1234567890123456 inside',
        });
        await pick('notes.txt');
        await waitFor(() => expect(screen.getByTestId('gate-count-critical')).toBeTruthy());

        await userEvent.click(screen.getByTestId('gate-next'));
        await userEvent.click(screen.getByTestId('gate-obfuscate'));

        expect(shownText()).toBe('ship it with [...] inside');
        expect(screen.queryByTestId('gate-count-critical')).toBeNull(); // and the gate agrees

        // Away and back: the redacted text is what is shown, not the copy still in the staging area.
        await pick('photo.jpg');
        await pick('notes.txt');
        expect(shownText()).toBe('ship it with [...] inside');

        await userEvent.click(screen.getByTestId('upload-review-unsafe'));
        expect(onImport).toHaveBeenCalledWith({}, { 'notes.txt': 'ship it with [...] inside' });
    });

    // A store with no import-gate folder: the reader is what it was before the gate existed.
    it('shows the text with no navigator when the store has no gate', async () => {
        renderModal();
        await pick('notes.txt');

        await waitFor(() => expect(shownText()).toBe(`the text of ${STAGING}/notes.txt`));
        expect(screen.queryByTestId('gate-navigator')).toBeNull();
    });

    it('cancels the whole upload', async () => {
        const { onCancel } = renderModal();
        await userEvent.click(screen.getByTestId('upload-review-cancel'));
        expect(onCancel).toHaveBeenCalled();
    });

    it('draws nothing when no upload is waiting', () => {
        renderModal({ review: null });
        expect(screen.queryByTestId('upload-review-tree')).toBeNull();
    });
});
