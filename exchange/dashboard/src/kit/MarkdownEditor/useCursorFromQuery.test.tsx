import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useCursorFromQuery } from './useCursorFromQuery';

const viewFor = (length: number) => ({
    state: { doc: { length } },
    dispatch: vi.fn(),
    focus: vi.fn(),
});

const draw = (view: any, search: string, enabled = true) => render(
    <MemoryRouter initialEntries={[`/units/abc/cadre.md.blog.md${search}#text=heading`]}>
        <Probe view={view} enabled={enabled} />
    </MemoryRouter>,
);

const Probe: React.FC<{ view: any; enabled: boolean }> = ({ view, enabled }) => {
    useCursorFromQuery(view, enabled);
    return null;
};

describe('useCursorFromQuery', () => {
    it('puts the caret at the end and consumes the query', () => {
        const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
        const view = viewFor(120);

        draw(view, '?cursor=end');

        expect(view.dispatch).toHaveBeenCalledWith(
            { selection: { anchor: 120 }, scrollIntoView: true });
        expect(view.focus).toHaveBeenCalled();
        expect(replaceState).toHaveBeenCalled();
        const url = replaceState.mock.calls[0][2] as string;
        expect(url).not.toContain('cursor=');
        expect(url).toContain('#text=heading');
        replaceState.mockRestore();
    });

    it('leaves the caret alone without the query, without a view, or when off', () => {
        const plain = viewFor(50);
        draw(plain, '');
        expect(plain.dispatch).not.toHaveBeenCalled();

        const noView = viewFor(50);
        draw(null, '?cursor=end');
        expect(noView.dispatch).not.toHaveBeenCalled();

        const disabled = viewFor(50);
        draw(disabled, '?cursor=end', false);
        expect(disabled.dispatch).not.toHaveBeenCalled();
    });
});
