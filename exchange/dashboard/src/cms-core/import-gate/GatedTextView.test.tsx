import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { GatedTextView } from './GatedTextView';
import { GateMatcher, parseCategory } from './matchers';

/** A gate of three rules at three levels, so a test can say which one it means. */
const gate: GateMatcher[] = parseCategory('demo.json', {
    category: 'demo',
    label: 'Demo',
    criticality: 'medium',
    matchers: [
        { label: 'AWS key', pattern: '\\bAKIA[0-9A-Z]{16}\\b', criticality: 'critical', hint: 'Rotate it.' },
        { label: 'Private address', pattern: '\\b10(?:\\.\\d{1,3}){3}\\b', criticality: 'high' },
        { label: 'Postcode', pattern: '\\b75\\d{3}\\b', criticality: 'low' },
    ],
});

const TEXT = [
    'key AKIA1234567890123456 in the header',
    'host 10.0.0.1 and host 10.0.0.2',
    'office at 75009',
].join('\n');

const renderView = (props: Partial<React.ComponentProps<typeof GatedTextView>> = {}) =>
    render(<GatedTextView text={TEXT} matchers={gate} {...props} />);

/** The findings the pane actually painted, in order. */
const painted = () => Array.from(document.querySelectorAll('mark')).map(mark => mark.textContent);

describe('GatedTextView', () => {
    it('paints every finding and leaves the text otherwise whole', () => {
        renderView();

        expect(painted()).toEqual(['AKIA1234567890123456', '10.0.0.1', '10.0.0.2', '75009']);
        expect(screen.getByTestId('gate-text').textContent).toBe(TEXT);
    });

    // The colour is the criticality, and the criticality is the whole point of the highlight.
    it('paints each finding at its own level', () => {
        renderView();
        const [key, host] = Array.from(document.querySelectorAll('mark'));

        expect(key.className).toContain('critical');
        expect(host.className).toContain('high');
        expect(key.className).not.toContain('high');
    });

    it('counts the findings by level before any of them is read', () => {
        renderView();

        expect(screen.getByTestId('gate-count-critical').textContent).toBe('1 critical');
        expect(screen.getByTestId('gate-count-high').textContent).toBe('2 high');
        expect(screen.getByTestId('gate-count-low').textContent).toBe('1 low');
        expect(screen.queryByTestId('gate-count-medium')).toBeNull(); // nothing at that level
        expect(screen.getByTestId('gate-position').textContent).toBe('4 found');
    });

    it('steps to the next finding, and names the one it is on', async () => {
        renderView();
        await userEvent.click(screen.getByTestId('gate-next'));

        expect(screen.getByTestId('gate-position').textContent).toBe('1 / 4');
        expect(screen.getByTestId('gate-current').textContent).toContain('Demo · AWS key');
        expect(screen.getByTestId('gate-current').textContent).toContain('Rotate it.');

        await userEvent.click(screen.getByTestId('gate-next'));
        expect(screen.getByTestId('gate-current').textContent).toContain('Private address');
    });

    it('steps backwards, and wraps at both ends', async () => {
        renderView();
        await userEvent.click(screen.getByTestId('gate-previous')); // from nowhere, to the last

        expect(screen.getByTestId('gate-position').textContent).toBe('4 / 4');
        expect(screen.getByTestId('gate-current').textContent).toContain('Postcode');

        await userEvent.click(screen.getByTestId('gate-next')); // past the end, round to the first
        expect(screen.getByTestId('gate-position').textContent).toBe('1 / 4');
    });

    // The one being read is outlined rather than recoloured: its level has to stay legible while
    // the navigator is standing on it.
    it('marks the finding it is standing on without losing its level', async () => {
        renderView();
        await userEvent.click(screen.getByTestId('gate-next'));

        const here = screen.getByTestId('gate-finding-0');
        expect(here.className).toContain('here');
        expect(here.className).toContain('critical');
        expect(screen.getByTestId('gate-finding-1').className).not.toContain('here');
    });

    // Six criticals in a page of medium noise is the case this is for: narrow the walk, step it.
    it('narrows the walk to one level, and widens it again', async () => {
        renderView();
        await userEvent.click(screen.getByTestId('gate-count-high'));

        expect(screen.getByTestId('gate-position').textContent).toBe('2 found');
        await userEvent.click(screen.getByTestId('gate-next'));
        expect(screen.getByTestId('gate-current').textContent).toContain('Private address');
        expect(screen.getByTestId('gate-position').textContent).toBe('1 / 2');

        // Everything is still painted — filtering says what to step to, not what to show.
        expect(painted()).toHaveLength(4);

        await userEvent.click(screen.getByTestId('gate-count-high'));
        expect(screen.getByTestId('gate-position').textContent).toBe('4 found');
    });

    it('says when the gate found nothing at all', () => {
        renderView({ text: 'an ordinary sentence' });

        expect(screen.getByTestId('gate-clean')).toBeTruthy();
        expect(screen.queryByTestId('gate-next')).toBeNull();
        expect(painted()).toEqual([]);
    });

    // A store with no import-gate folder: the pane is a reader and says nothing about a gate.
    it('draws no navigator when the store has no gate', () => {
        renderView({ matchers: [] });

        expect(screen.queryByTestId('gate-navigator')).toBeNull();
        expect(screen.getByTestId('gate-text').textContent).toBe(TEXT);
    });

    it('starts over when the document changes', async () => {
        const { rerender } = renderView();
        await userEvent.click(screen.getByTestId('gate-next'));
        expect(screen.getByTestId('gate-position').textContent).toBe('1 / 4');

        rerender(<GatedTextView text={'other AKIA1234567890123456'} matchers={gate} />);
        expect(screen.getByTestId('gate-position').textContent).toBe('1 found');
        expect(screen.queryByTestId('gate-current')).toBeNull();
    });

    // With a resetKey the walk belongs to the *file*, not to the string: obfuscating rewrites the
    // text under the cursor, and coming back to the top of a document each time would make the
    // second redaction cost as many clicks as the first.
    it('keeps its place when the text is edited but the document is the same', async () => {
        const { rerender } = renderView({ resetKey: 'notes.txt' });
        await userEvent.click(screen.getByTestId('gate-next'));
        await userEvent.click(screen.getByTestId('gate-next'));
        expect(screen.getByTestId('gate-current').textContent).toContain('Private address');

        rerender(<GatedTextView text={`${TEXT} and 10.0.0.9`} matchers={gate} resetKey="notes.txt" />);
        expect(screen.getByTestId('gate-position').textContent).toBe('2 / 5');

        rerender(<GatedTextView text={TEXT} matchers={gate} resetKey="other.txt" />);
        expect(screen.getByTestId('gate-position').textContent).toBe('4 found');
    });

    describe('obfuscating', () => {
        it('is not offered when the pane cannot be written to', () => {
            renderView();
            expect(screen.queryByTestId('gate-obfuscate')).toBeNull();
        });

        it('waits for a finding to be standing on', async () => {
            renderView({ onTextChange: () => undefined });
            expect((screen.getByTestId('gate-obfuscate') as HTMLButtonElement).disabled).toBe(true);

            await userEvent.click(screen.getByTestId('gate-next'));
            expect((screen.getByTestId('gate-obfuscate') as HTMLButtonElement).disabled).toBe(false);
        });

        it('replaces the current finding with [...] and leaves the rest of the text alone', async () => {
            const onTextChange = vi.fn();
            renderView({ onTextChange });

            await userEvent.click(screen.getByTestId('gate-next')); // the AWS key, first in the text
            await userEvent.click(screen.getByTestId('gate-obfuscate'));

            expect(onTextChange).toHaveBeenCalledWith(TEXT.replace('AKIA1234567890123456', '[...]'));
        });

        it('cuts the finding the navigator is on, and not the first one', async () => {
            const onTextChange = vi.fn();
            renderView({ onTextChange });

            await userEvent.click(screen.getByTestId('gate-previous')); // wraps to the last: 75009
            await userEvent.click(screen.getByTestId('gate-obfuscate'));

            expect(onTextChange).toHaveBeenCalledWith(TEXT.replace('75009', '[...]'));
        });

        // The pane is controlled: what it shows is whatever its caller kept, and the gate re-reads
        // it, so the finding that was cut is gone from the counts as well as from the text.
        it('drops the finding from the walk once the caller keeps the new text', async () => {
            const { rerender } = renderView({ onTextChange: () => undefined, resetKey: 'notes.txt' });
            expect(screen.getByTestId('gate-count-critical').textContent).toBe('1 critical');

            rerender(<GatedTextView
                text={TEXT.replace('AKIA1234567890123456', '[...]')}
                matchers={gate}
                onTextChange={() => undefined}
                resetKey="notes.txt" />);

            expect(screen.queryByTestId('gate-count-critical')).toBeNull();
            expect(screen.getByTestId('gate-position').textContent).toBe('3 found');
        });
    });

    describe('a rendered preview', () => {
        const rendered = (text: string) => <div data-testid="rich">{text}</div>;

        // Markdown is a document and is shown as one. Nothing of ours goes into that DOM — it
        // belongs to React — so there are no <mark> elements and the findings are painted through
        // the Highlight API, which jsdom does not have. The navigator is what still works here.
        it('hands the text to the renderer instead of drawing source', () => {
            renderView({ renderRich: rendered });

            expect(screen.getByTestId('rich').textContent).toBe(TEXT);
            expect(document.querySelectorAll('mark')).toHaveLength(0);
        });

        it('still counts and walks the findings', async () => {
            renderView({ renderRich: rendered });

            expect(screen.getByTestId('gate-count-critical').textContent).toBe('1 critical');
            await userEvent.click(screen.getByTestId('gate-next'));
            expect(screen.getByTestId('gate-current').textContent).toContain('AWS key');
        });

        // The scan reads the source, so a cut lands in the source — the file that will be imported
        // — and not in whatever the renderer made of it.
        it('obfuscates the source, not the rendering', async () => {
            const onTextChange = vi.fn();
            renderView({ renderRich: rendered, onTextChange });

            await userEvent.click(screen.getByTestId('gate-next'));
            await userEvent.click(screen.getByTestId('gate-obfuscate'));

            expect(onTextChange).toHaveBeenCalledWith(TEXT.replace('AKIA1234567890123456', '[...]'));
        });
    });

    it('takes the test id its caller reads the text back by', () => {
        renderView({ testId: 'upload-review-index' });
        expect(screen.getByTestId('upload-review-index').textContent).toBe(TEXT);
    });
});
