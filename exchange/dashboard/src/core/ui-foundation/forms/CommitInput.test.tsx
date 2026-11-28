import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CommitInput } from './CommitInput';

it('commits each edit once and keeps focus on Enter by default', () => {
    const commit = vi.fn();
    const { rerender } = render(<CommitInput value="Before" onCommit={commit} autoFocus />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'First edit' } });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Before');
    rerender(<CommitInput value="First edit" onCommit={commit} />);
    fireEvent.blur(input);
    expect(commit.mock.calls).toEqual([['First edit']]);

    fireEvent.change(input, { target: { value: 'Next edit' } });
    fireEvent.blur(input);
    expect(commit.mock.calls).toEqual([['First edit'], ['Next edit']]);
});

it('releases focus on Enter and leaves a controlled draft to its caller', () => {
    const commit = vi.fn();
    const Field = () => {
        const [draft, setDraft] = React.useState('3');
        return <CommitInput type="number" value={draft} autoFocus blurOnEnter
            onDraftChange={setDraft} onCommit={commit} />;
    };
    render(<Field />);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '-2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).not.toHaveFocus();
    expect(input).toHaveValue(-2);
    expect(commit.mock.calls).toEqual([['-2']]);
});

it('keeps the typed value across external updates when requested', () => {
    const commit = vi.fn();
    const { rerender } = render(<CommitInput value="2" onCommit={commit} preserveDraft />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '37' } });
    rerender(<CommitInput value="3" onCommit={commit} preserveDraft />);

    expect(input).toHaveValue('37');
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledWith('37');
    expect(input).toHaveValue('3');
});

it('cancels on Escape even when cancellation takes focus away', () => {
    const commit = vi.fn();
    const cancel = vi.fn(() => screen.getByRole('button').focus());
    render(<><CommitInput value="Before" autoFocus onCommit={commit} onCancel={cancel} /><button>Next</button></>);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Discard this' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(cancel).toHaveBeenCalledOnce();
    expect(input).toHaveValue('Before');
    expect(commit).not.toHaveBeenCalled();
});

it('lets the input method handle Enter and Escape during composition', () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CommitInput value="" autoFocus blurOnEnter onCommit={commit} onCancel={cancel} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(input).toHaveFocus();
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '日本語' } });
    act(() => input.blur());
    expect(commit.mock.calls).toEqual([['日本語']]);
});
