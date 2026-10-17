import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClassVersionTemplatePanel } from './ClassVersionTemplatePanel';
import { FlowNodeClass, FlowNodeClassVersion, newFlowNodeClass } from '../flowNodeClass';
import { BoardContent } from '../boardContent';

/**
 * The version's body in template mode, edited as the template it is: the same editor a
 * `.temp.md` file is modified with, over the body parsed rather than a file read.
 */

const board = vi.hoisted(() => ({
    content: null as BoardContent | null,
    editClassVersion: vi.fn(),
}));

vi.mock('../Hybridflow-ctx', () => ({
    useHybridflow: () => board,
}));

// The editor's voice inputs without the voice: plain boxes the test types into.
vi.mock('@cms-core', async importOriginal => ({
    ...(await importOriginal<typeof import('@cms-core')>()),
    VoiceInput: ({ value, onChange }: { value?: string; onChange?: (event: unknown) => void }) => (
        <input data-testid="template-name" value={value ?? ''} onChange={onChange} />
    ),
    VoiceTextArea: ({ value, onChange, placeholder }: {
        value?: string; onChange?: (event: unknown) => void; placeholder?: string;
    }) => (
        <textarea data-testid={`template-area-${placeholder ?? ''}`} value={value ?? ''}
            placeholder={placeholder} onChange={onChange} />
    ),
}));

const BODY = '# Review\n\n## Root\n\n### textTemplate\n\n```text\nRead ${what:text}.\n```\n';

const version = (
    id: string, status: FlowNodeClassVersion['status'], body: string = BODY,
): FlowNodeClassVersion => ({ id, number: 1, body, criteria: [], template: true, agent: '', status });

const show = (flowNodeClass: FlowNodeClass, versionId: string) => {
    board.content = {
        flowNodes: [], flowNodeClasses: [flowNodeClass], workflows: [], workflowClasses: [],
    };
    return render(<ClassVersionTemplatePanel classId={flowNodeClass.id} versionId={versionId} />);
};

const classOf = (versions: FlowNodeClassVersion[]): FlowNodeClass => ({
    ...newFlowNodeClass('human'), id: 'c1', title: 'Review', versions,
});

beforeEach(() => {
    board.content = null;
    vi.clearAllMocks();
});

afterEach(cleanup);

describe('ClassVersionTemplatePanel', () => {
    it('edits the version body as the template it is, writing each edit straight through', () => {
        show(classOf([version('v1', 'draft')]), 'v1');

        const root = screen.getByTestId('template-area-Template Body');
        expect(root).toHaveValue('Read ${what:text}.');

        fireEvent.change(root, { target: { value: 'Read carefully.' } });

        expect(board.editClassVersion).toHaveBeenCalledWith(
            'c1', 'v1', { body: expect.stringContaining('Read carefully.') });
        const written = board.editClassVersion.mock.calls[0][2].body as string;
        expect(written).toContain('## Root');
    });

    it('reads a plain body as the Root alone, rather than refusing it', () => {
        show(classOf([version('v1', 'draft', 'Just words.')]), 'v1');

        expect(screen.getByTestId('template-area-Template Body')).toHaveValue('Just words.');
    });

    it('says published versions are read-only, and edits nothing', () => {
        show(classOf([version('v1', 'published')]), 'v1');

        expect(screen.queryByTestId('class-version-template-editor')).toBeNull();
        expect(screen.getByText(/read-only/)).toBeTruthy();
    });

    it('says the version is gone where the board no longer holds it', () => {
        show(classOf([version('v1', 'draft')]), 'v2');

        expect(screen.queryByTestId('class-version-template-editor')).toBeNull();
        expect(screen.getByText(/gone from the board/)).toBeTruthy();
    });
});
