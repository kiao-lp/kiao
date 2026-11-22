import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ReindexResult } from 'kiao-worker';
import { UploadTree } from './folderUpload';
import { UploadReviewModal } from './UploadReviewModal';
import { UploadDecisions, buildReview } from './uploadReview';
import { GateMatcher, parseCategory } from '../../../import-gate';

// Stub renderer: tests only check that Markdown is rendered, not shown as source.
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

// Fixture: converted doc, unreadable image, plain text, converted doc in a subfolder.
const review = buildReview(
    STAGING, 'archive',
    tree(['rapport.pdf', 'photo.jpg', 'notes.txt', 'mail/note.eml']),
    { succeeded: 4, failed: [] },
    converted('rapport.pdf.index.md', 'mail/note.eml.index.md'));

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

    // Plain-text files are gated directly; no conversion is required.
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

    // Files without an index still open and default to import.
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
        expect(checked()).toBe(1); // Verifies the click registered.
        expect(screen.getByTestId('upload-review-node-rapport.pdf').textContent).toContain('delete');

        // Decisions are per file; the next file starts undecided.
        await pick('mail/note.eml');
        expect(checked()).toBe(0);
    });

    // "Import as text" requires an index to replace the file.
    it('offers Import as text only for a file that was converted', async () => {
        renderModal();
        // antd puts a Radio's extra props on the input itself, so the test id is the control.
        const asText = () => screen.getByTestId('upload-review-as-text') as HTMLInputElement;

        await pick('rapport.pdf');
        expect(asText().disabled).toBe(false);

        await pick('notes.txt'); // Already text; not converted.
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

        await pick('notes.txt'); // Plain text also requires a decision.
        await userEvent.click(screen.getByTestId('upload-review-import'));
        expect(safe().disabled).toBe(true);

        await pick('mail/note.eml');
        await userEvent.click(screen.getByTestId('upload-review-delete'));
        expect(safe().disabled).toBe(false);

        await userEvent.click(safe());
        const expected: UploadDecisions = { 'rapport.pdf': 'import', 'notes.txt': 'import', 'mail/note.eml': 'delete' };
        expect(onImport).toHaveBeenCalledWith(expected, {});
    });

    // Unsafe import bypasses the gate with no confirmation.
    it('offers Unsafe import from the start, and imports without confirming', async () => {
        const { onImport } = renderModal();
        const unsafe = screen.getByTestId('upload-review-unsafe') as HTMLButtonElement;
        expect(unsafe.disabled).toBe(false);

        await userEvent.click(unsafe);
        expect(onImport).toHaveBeenCalledWith({}, {});
    });

    // The gate runs over the shown text.
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

    // Redactions persist across file selection and go to import.
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
        expect(screen.queryByTestId('gate-count-critical')).toBeNull();

        // Redacted text persists after leaving and returning.
        await pick('photo.jpg');
        await pick('notes.txt');
        expect(shownText()).toBe('ship it with [...] inside');

        await userEvent.click(screen.getByTestId('upload-review-unsafe'));
        expect(onImport).toHaveBeenCalledWith({}, { 'notes.txt': 'ship it with [...] inside' });
    });

    // With no gate matchers, no gate navigator is shown.
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
