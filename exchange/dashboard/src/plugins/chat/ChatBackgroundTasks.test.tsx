import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ChatBackgroundTasks, countBackground } from './ChatBackgroundTasks';
import type { BackgroundTask } from './chatMessages';

// ── What the panel shows of the turn's background work ─────────────────────────
//
// One line of counts — how many agents run, wait and finished — opening onto one row per task,
// with a workflow's folded children beneath it. What is pinned here is that the counts are over
// the leaves and the rows carry every task's word: a wait with a breakdown instead of a wait with
// a sentence.

const show = (tasks: BackgroundTask[]) => render(<ChatBackgroundTasks tasks={tasks} />);

const scout = (state: BackgroundTask['state'], status: string): BackgroundTask => ({
    id: 'item-s1', kind: 'subagent', label: 'subagent "scout"', status, state, children: [],
});

const nightly: BackgroundTask = {
    id: 'item-wf', kind: 'workflow', label: 'workflow "nightly"',
    status: 'inProgress', state: 'running',
    children: [
        { childId: 'one', label: 'one', status: 'running', state: 'running' },
        { childId: 'two', label: 'two', status: 'manualReconciliation', state: 'waiting' },
        { childId: 'three', label: 'three', status: 'completed', state: 'finished', terminal: 'completed' },
    ],
};

describe('countBackground', () => {
    it('counts the leaves: a workflow counts its children, a delegation itself', () => {
        expect(countBackground([scout('running', 'running'), nightly]))
            .toEqual({ running: 2, waiting: 1, finished: 1 });
    });

    it('counts a childless workflow as one task of its own', () => {
        const alone: BackgroundTask = { ...nightly, children: [] };
        expect(countBackground([alone])).toEqual({ running: 1, waiting: 0, finished: 0 });
    });

    it('counts no lane it was never sent', () => {
        const strange = scout('sideways' as BackgroundTask['state'], 'sideways');
        expect(countBackground([strange])).toEqual({ running: 0, waiting: 0, finished: 0 });
    });
});

describe('ChatBackgroundTasks', () => {
    it('renders nothing where the turn handed nothing off', () => {
        const { container } = show([]);

        expect(container.textContent).toBe('');
    });

    it('reads the counts as one line, over the leaves', () => {
        show([scout('running', 'running'), nightly]);

        expect(screen.getByRole('status').getAttribute('aria-label'))
            .toBe('Background work: 2 running · 1 waiting · 1 finished');
        expect(screen.getByRole('button', { expanded: true }))
            .toHaveTextContent('2 running · 1 waiting · 1 finished');
    });

    it('names only the lanes that hold anything', () => {
        show([scout('finished', 'completed')]);

        expect(screen.getByRole('button')).toHaveTextContent('1 finished');
        expect(screen.getByRole('button')).not.toHaveTextContent('running');
    });

    it('opens onto one row per task, with a workflow’s children beneath it', () => {
        const { container } = show([scout('waiting', 'manualReconciliation'), nightly]);

        const rows = [...container.querySelectorAll('.chat-background-row')]
            .map(row => [...row.children].map(child => child.textContent ?? '').join(' '));
        expect(rows).toEqual([
            '◐ subagent "scout" manualReconciliation',
            '◉ workflow "nightly" inProgress',
            '◉ one running',
            '◐ two manualReconciliation',
            '✓ three completed',
        ]);
    });

    it('starts open while anything is still out, and closed once everything landed', () => {
        const open = show([scout('running', 'running')]);
        expect(open.container.querySelector('.chat-background-rows')).not.toBeNull();
        expect(screen.getByRole('button', { expanded: true })).toBeDefined();
        open.unmount();

        show([scout('finished', 'completed')]);
        expect(screen.getByRole('button', { expanded: false })).toBeDefined();
    });

    it('toggles the rows without losing the counts', () => {
        show([scout('running', 'running')]);
        const toggle = screen.getByRole('button', { expanded: true });

        fireEvent.click(toggle);
        expect(screen.queryByText('subagent "scout"')).toBeNull();
        expect(screen.getByRole('button', { expanded: false })).toHaveTextContent('1 running');

        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('subagent "scout"')).toBeDefined();
    });
});
