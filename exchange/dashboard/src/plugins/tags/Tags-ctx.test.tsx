import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The store's tag list, and the writes back to `kiao-user-config/tags.json`.
 *
 * What is worth pinning here is the one thing the shape of the provider makes easy to get wrong:
 * **two changes in one event**. Three words pasted into a picker are three `add` calls before
 * anything renders, and a handler reading the list as it stood at the last render would write each
 * one out over the one before it.
 */

const files = vi.hoisted(() => ({
    text: '' as string,
    getFileText: vi.fn(),
    update: vi.fn(),
}));

vi.mock('@cms-core', () => ({ useWorkerClient: () => files }));

import { TagsProvider, useTags } from './Tags-ctx';
import { TAGS_PATH } from './tagsFile';

/** Everything the provider offers, reachable from a test without a panel around it. */
let api: ReturnType<typeof useTags>;

const Probe: React.FC = () => {
    api = useTags();
    React.useEffect(() => { api.ensureLoaded(); }, []);
    return <span data-testid="tags">{api.tags.map(tag => `${tag.label}:${tag.color}`).join(' ')}</span>;
};

const mount = async () => {
    await act(async () => { render(<TagsProvider><Probe /></TagsProvider>); });
};

/** What the list on screen says, which is also what the next write will hold. */
const shown = () => screen.getByTestId('tags').textContent;

beforeEach(() => {
    files.text = '[{"label":"bug","color":"#e66767"}]';
    files.getFileText.mockImplementation(() => Promise.resolve(files.text));
    files.update.mockReset();
    files.update.mockResolvedValue(undefined);
});

describe('the store’s tags', () => {
    it('reads the file the first time something asks for it', async () => {
        await mount();
        expect(files.getFileText).toHaveBeenCalledWith(TAGS_PATH);
        expect(shown()).toBe('bug:#e66767');
    });

    // A store that has never named a tag has no file, which is not an error — it is the empty list.
    it('reads a store with no file at all as no tags', async () => {
        files.getFileText.mockRejectedValue(new Error('404'));
        await mount();
        expect(shown()).toBe('');
    });

    it('keeps every word of a burst added in one event', async () => {
        await mount();
        // What a paste into a tag picker does: three words, one handler, nothing rendered between.
        act(() => { ['ui', 'ops', 'docs'].forEach(word => api.add(word)); });
        expect(shown()).toBe('bug:#e66767 ui:#3987e5 ops:#d95926 docs:#199e70');
    });

    it('gives back the tag a word already names rather than adding it twice', async () => {
        await mount();
        let given!: { label: string };
        act(() => { given = api.add('BUG'); });
        expect(given.label).toBe('bug');
        expect(shown()).toBe('bug:#e66767');
    });

    it('refuses a rename onto a word the list already holds, and says so', async () => {
        files.text = '[{"label":"bug","color":"#e66767"},{"label":"ui","color":"#3987e5"}]';
        await mount();
        let took!: boolean;
        act(() => { took = api.rename(1, 'Bug'); });
        expect(took).toBe(false);
        expect(shown()).toBe('bug:#e66767 ui:#3987e5');
    });

    it('renames, recolours, reorders and removes', async () => {
        files.text = '[{"label":"bug","color":"#e66767"},{"label":"ui","color":"#3987e5"}]';
        await mount();
        act(() => { api.rename(0, ' needs   review '); });
        expect(shown()).toBe('needs review:#e66767 ui:#3987e5');
        // A colour arrives from a picker as `#123456` or `#123ABC`; the file holds one spelling.
        act(() => { api.recolor(1, '#12AB56'); });
        expect(shown()).toBe('needs review:#e66767 ui:#12ab56');
        act(() => { api.move(0, 1); });
        expect(shown()).toBe('ui:#12ab56 needs review:#e66767');
        act(() => { api.remove(0); });
        expect(shown()).toBe('needs review:#e66767');
    });

    // No Save button here either: the writes are debounced, and what is owed leaves on the way out.
    it('writes the file once for a burst, on the way out', async () => {
        const { unmount } = await (async () => {
            let result!: ReturnType<typeof render>;
            await act(async () => { result = render(<TagsProvider><Probe /></TagsProvider>); });
            return result;
        })();
        act(() => { ['ui', 'ops'].forEach(word => api.add(word)); });
        expect(files.update).not.toHaveBeenCalled();

        unmount();

        expect(files.update).toHaveBeenCalledTimes(1);
        const [path, content] = files.update.mock.calls[0];
        expect(path).toBe(TAGS_PATH);
        expect(JSON.parse(content).map((tag: { label: string }) => tag.label))
            .toEqual(['bug', 'ui', 'ops']);
    });
});
