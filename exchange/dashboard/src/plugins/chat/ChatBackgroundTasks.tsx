// because the children are the harnesses and the workflow is their run. bring back the wait that never ends.

import React, { useState } from 'react';
import type { BackgroundState, BackgroundTask } from './chatMessages';

export interface BackgroundCounts {
    running: number;
    waiting: number;
    finished: number;
}

/** How many harnesses run, wait and finished — over the leaves, not the runs. */
export const countBackground = (tasks: BackgroundTask[]): BackgroundCounts => {
    const counts: BackgroundCounts = { running: 0, waiting: 0, finished: 0 };
    const count = (state: BackgroundState) => {
        if (state === 'running') counts.running += 1;
        else if (state === 'waiting') counts.waiting += 1;
        else if (state === 'finished') counts.finished += 1;
    };
    tasks.forEach(task => {
        if (task.children.length) task.children.forEach(child => count(child.state));
        else count(task.state);
    });
    return counts;
};

const stateGlyph = (state: BackgroundState): string => {
    if (state === 'running') return '◉';
    if (state === 'waiting') return '◐';
    if (state === 'finished') return '✓';
    return '·';
};

/**
 * The counts as one line: the lanes that hold anything, so a settled roster reads as what it is.
 * A roster no lane claims — words the service never sends — is still a roster, and says how many rows.
 */
const countsLine = (tasks: BackgroundTask[], counts: BackgroundCounts): string => {
    const parts = [
        counts.running ? `${counts.running} running` : '',
        counts.waiting ? `${counts.waiting} waiting` : '',
        counts.finished ? `${counts.finished} finished` : '',
    ].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    return tasks.length === 1 ? '1 background task' : `${tasks.length} background tasks`;
};

const TaskRow: React.FC<{
    state: BackgroundState;
    label: string;
    status: string;
    title: string;
    child?: boolean;
}> = ({ state, label, status, title, child }) => (
    <div
        className={`chat-background-row${child ? ' chat-background-row--child' : ''}`}
        title={title}
    >
        <span className="chat-background-glyph" aria-hidden>{stateGlyph(state)}</span>
        <span className="chat-background-label">{label}</span>
        <span className="chat-background-status">{status}</span>
    </div>
);

export const ChatBackgroundTasks: React.FC<{ tasks?: BackgroundTask[] }> = ({ tasks = [] }) => {
    const [open, setOpen] = useState(
        () => tasks.some(task => task.state !== 'finished'
            || task.children.some(child => child.state !== 'finished')),
    );
    if (!tasks.length) return null;
    const counts = countBackground(tasks);
    return (
        <div className="chat-background" role="status" aria-label={`Background work: ${countsLine(tasks, counts)}`}>
            <button
                type="button"
                className="chat-background-toggle"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
            >
                🤖 {countsLine(tasks, counts)}
            </button>
            {open && (
                <div className="chat-background-rows">
                    {tasks.map(task => (
                        <React.Fragment key={task.id}>
                            <TaskRow
                                state={task.state}
                                label={task.label}
                                status={task.status}
                                title={`${task.kind} · ${task.status}`}
                            />
                            {task.children.map(child => (
                                <TaskRow
                                    key={child.childId}
                                    child
                                    state={child.state}
                                    label={child.label}
                                    status={child.terminal || child.status}
                                    title={child.terminal
                                        ? `${child.status} · ended ${child.terminal}`
                                        : child.status}
                                />
                            ))}
                        </React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
};
