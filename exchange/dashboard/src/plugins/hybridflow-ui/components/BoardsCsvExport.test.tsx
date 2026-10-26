import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Modal, message } from 'antd';

/**
 * The boards list carries the one place archived cards are still read: an icon button offering
 * every archived card on every board as one `.csv` file. These press it for real — what is
 * asserted is the file the press offers, and the sentence where there is nothing to offer.
 */
vi.mock('@cms-core', async () => ({
    useAuthToken: () => 'tok',
    LayoutContent: ({ children, additionalPanels }: {
        children: React.ReactNode; additionalPanels?: React.ReactNode;
    }) => <div>{additionalPanels}{children}</div>,
    TopBanner: () => null,
    Tooltip: (await import('antd')).Tooltip,
}));

import { BoardsPage } from './BoardsPage';
import { FakeHybridflowClient, HybridflowClientProvider } from '../service';
import { boardOf } from '../test/fixtures';
import { newFlowNode } from '../boardContent';
import { ARCHIVED_FLOW_NODES_CSV_FILENAME } from '../archivedFlowNodesCsv';
import { readFileText } from '../boardArchive';

let service: FakeHybridflowClient;
let archivedId: string;
let offered: { blob: Blob | null; filename: string | null };

beforeEach(() => {
    const archived = { ...newFlowNode('Away'), archived: true };
    archived.settings = { agent: 'agent-1', effort: 'high' };
    archivedId = archived.id;
    service = new FakeHybridflowClient(boardOf([newFlowNode('Live'), archived]));
    service.agentsList = [{
        id: 'agent-1', name: 'Scribe', platform: 'muse', model: 'muse-spark',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', revision: 1,
    }];
    service.usageTotalsByFlowNode = {
        [archivedId]: {
            reports: 1, inputTokens: 100, outputTokens: 50,
            cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
            costUsdMicros: 1_000_000,
        },
    };
    // The download, caught: the object URL keeps the blob, the anchor keeps the filename.
    offered = { blob: null, filename: null };
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
        offered.blob = blob as Blob;
        return 'blob:archived-flow-nodes';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { /* kept for the assertion */ });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
        function (this: HTMLAnchorElement) {
            offered.filename = this.download;
        },
    );
});

afterEach(() => {
    Modal.destroyAll();
    message.destroy();
    vi.restoreAllMocks();
});

const renderPage = () => render(
    <MemoryRouter initialEntries={['/boards']}>
        <HybridflowClientProvider client={service.asClient()}>
            <BoardsPage />
        </HybridflowClientProvider>
    </MemoryRouter>,
);

describe('BoardsPage archived flow nodes export', () => {
    it('offers every archived card as one .csv file, live cards left out', async () => {
        renderPage();
        await screen.findAllByTestId(/board-row-/);

        await userEvent.click(screen.getByTestId('export-archived-flow-nodes'));

        await waitFor(() => expect(offered.blob).not.toBeNull());
        expect(offered.filename).toBe(ARCHIVED_FLOW_NODES_CSV_FILENAME);
        const text = await readFileText(offered.blob!);
        const [header, row] = text.trim().split('\n');
        expect(header).toBe('board,title,agent,model,effort,reports,input_tokens,output_tokens,'
            + 'cache_read_tokens,cache_write_tokens,reasoning_tokens,cost_usd,node_class,'
            + 'complexity');
        expect(row).toBe('board,Away,Scribe,muse-spark,high,1,100,50,0,0,0,1,,');
        expect(text).not.toContain('Live');
    });

    it('says so in the list where no board holds an archived card', async () => {
        service = new FakeHybridflowClient(boardOf([newFlowNode('Live')]));
        renderPage();
        await screen.findAllByTestId(/board-row-/);

        await userEvent.click(screen.getByTestId('export-archived-flow-nodes'));

        expect(await screen.findByText('No archived flow nodes to export.')).toBeInTheDocument();
        expect(offered.blob).toBeNull();
    });
});
