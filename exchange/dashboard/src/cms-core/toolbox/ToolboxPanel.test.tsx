import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkerClient, WorkerClientMockProvider, Toolbox, ToolboxComponent, ToolboxJob } from 'kiao-worker';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginCatalogue } from '../core/assembly';
import { ToolboxPanel } from './ToolboxPanel';

const componentOf = (over: Partial<ToolboxComponent>): ToolboxComponent => ({
    id: 'fetch', kind: 'mcp', title: 'fetch', role: 'web page to markdown',
    state: 'available', registered: false, ...over,
});

const toolboxOf = (over: Partial<Toolbox> = {}): Toolbox => ({
    enabled: true, platform: 'debian', prefix: '/toolbox', strict: false,
    components: [componentOf({})], ...over,
});

const client = {
    getToolbox: vi.fn(),
    getToolboxJob: vi.fn(),
    installToolboxComponents: vi.fn(),
    uninstallToolboxComponents: vi.fn(),
    setToolboxRegistration: vi.fn(),
} as unknown as WorkerClient;

const renderPanel = () => render(
    <WorkerClientMockProvider mock={{ workerClient: client }}>
        <ToolboxPanel />
    </WorkerClientMockProvider>,
);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('ToolboxPanel', () => {
    it('installs a component with no missing dependency without asking', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf());
        (client.installToolboxComponents as any).mockResolvedValue(
            { id: 'j1', op: 'install', ids: ['fetch'], state: 'done', log: '', startedAt: 'now' } as ToolboxJob);

        renderPanel();
        const row = await screen.findByTestId('toolbox-row-fetch');
        await userEvent.click(row.querySelector('button')!);

        await waitFor(() => expect(client.installToolboxComponents).toHaveBeenCalledWith(['fetch']));
    });

    // The dependency prompt the panel exists to give: the closure comes from the catalogue the
    // panel already holds, so the confirmation names what will happen before anything is sent.
    it('names the missing dependencies before installing', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({
            components: [
                componentOf({ requires: ['uv'], missingRequires: ['uv'] }),
                componentOf({ id: 'uv', kind: 'runtime', title: 'uv', role: 'python tools' }),
            ],
        }));
        (client.installToolboxComponents as any).mockResolvedValue(
            { id: 'j1', op: 'install', ids: ['uv', 'fetch'], state: 'running', log: '', startedAt: 'now' } as ToolboxJob);
        (client.getToolboxJob as any).mockResolvedValue(
            { id: 'j1', op: 'install', ids: ['uv', 'fetch'], state: 'done', log: 'done', startedAt: 'now' } as ToolboxJob);

        renderPanel();
        const row = await screen.findByTestId('toolbox-row-fetch');
        await userEvent.click(row.querySelector('button')!);

        expect(await screen.findByText(/needs uv/)).toBeInTheDocument();
        expect(client.installToolboxComponents).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Install' }));
        await waitFor(() => expect(client.installToolboxComponents).toHaveBeenCalledWith(['fetch']));
    });

    // A row this panel did not install offers nothing to remove: the ledger is the boundary of
    // what it owns, and a JDK the operator installed themselves is not its to delete.
    it('offers no uninstall for something already on the machine', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({
            components: [componentOf({
                id: 'jdk', kind: 'runtime', title: 'JDK 21', role: 'java', state: 'present',
                reason: 'already on this machine',
            })],
        }));

        renderPanel();
        const row = await screen.findByTestId('toolbox-row-jdk');
        expect(row.querySelectorAll('button')).toHaveLength(0);
        expect(screen.getByText('on this machine')).toBeInTheDocument();
    });

    // The row that had nothing to offer at all. An agent CLI baked into an image is on the machine
    // and is not this panel's to delete — a `docker run` would put it back — so the switch that
    // takes the agent out of the tab is the control that has to be there, and the one thing that
    // made "disable Codex" impossible was that it was not.
    it('offers the switch on an agent CLI it did not install', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({
            components: [componentOf({
                id: 'codex-cli', kind: 'runtime', agent: 'codex', title: 'Codex CLI',
                role: 'the second agent', state: 'present', registered: true,
                reason: 'already on this machine',
            })],
        }));
        (client.setToolboxRegistration as any).mockResolvedValue(toolboxOf({ components: [] }));

        renderPanel();
        const row = await screen.findByTestId('toolbox-row-codex-cli');
        // No uninstall — that principle does not move — and a switch that is on.
        expect(row.querySelectorAll('button')).toHaveLength(1);
        await userEvent.click(row.querySelector('button')!);

        await waitFor(() =>
            expect(client.setToolboxRegistration).toHaveBeenCalledWith(['codex-cli'], false));
    });

    // The other half of the same row: a CLI this panel *did* install is removed from it, which is
    // what makes installing one on demand a reversible act rather than a one-way door.
    it('offers both the switch and the uninstall on an agent CLI it installed', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({
            components: [componentOf({
                id: 'claude-cli', kind: 'runtime', agent: 'claude', title: 'Claude Code CLI',
                role: 'the agent behind the Conversations tab', state: 'installed', registered: true,
                channel: 'claude-release', version: '2.1.0',
            })],
        }));

        renderPanel();
        const row = await screen.findByTestId('toolbox-row-claude-cli');
        expect(row.querySelectorAll('button')).toHaveLength(2);
    });

    // The sentence the panel owes the reader, and the one nobody would guess.
    it('says a turn is held to the servers switched on here', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({ strict: true }));
        renderPanel();
        expect(await screen.findByText(/handed exactly the servers switched on here/)).toBeInTheDocument();
    });

    it('shows the running install and its log', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({
            job: { id: 'j1', op: 'install', ids: ['fetch'], state: 'running', log: 'downloading…', startedAt: 'now' },
        }));
        (client.getToolboxJob as any).mockResolvedValue(
            { id: 'j1', op: 'install', ids: ['fetch'], state: 'running', log: 'downloading…', startedAt: 'now' } as ToolboxJob);

        renderPanel();
        expect(await screen.findByTestId('toolbox-job-log')).toHaveTextContent('downloading…');
    });

    // The row this panel used to get wrong: the files are installed, the server answers nothing, and
    // a green "installed" tag was all anyone saw. It has to read as broken, offer the install that
    // re-asks the question, and not offer the switch that would hand it to every turn.
    it('shows an installed server that does not answer as broken', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({
            components: [componentOf({
                id: 'papers', title: 'papers', state: 'unresponsive', channel: 'uv',
                reason: 'installed, but it did not answer when it was started: paper-search exited without answering',
            })],
        }));

        renderPanel();
        const row = await screen.findByTestId('toolbox-row-papers');
        expect(screen.getByText('does not answer')).toBeInTheDocument();
        expect(screen.getByText(/did not answer when it was started/)).toBeInTheDocument();
        expect(row.querySelector('.ant-switch')).toBeNull();
        expect(row.querySelectorAll('button').length).toBeGreaterThan(0);
    });

    // The panel used to be cut in three, with plugins in a scrolling box of their own. One list
    // now, in one order, whatever kind a row is.
    it('draws runtimes, servers and plugins as one list', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({
            components: [
                componentOf({}),
                componentOf({ id: 'uv', kind: 'runtime', title: 'uv', role: 'python tools' }),
            ],
        }));

        renderPanel();
        const rows = await screen.findAllByTestId(/^(toolbox|plugin)-row-/);
        const ids = rows.map(row => row.getAttribute('data-testid'));

        // Runtime, then server, then every plugin of this build — in one container.
        expect(ids.slice(0, 2)).toEqual(['toolbox-row-uv', 'toolbox-row-fetch']);
        expect(ids.slice(2)).toEqual(pluginCatalogue.map(entry => `plugin-row-${entry.id}`));
        expect(new Set(rows.map(row => row.parentElement)).size).toBe(1);
    });

    it('narrows the list to one kind', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf());

        renderPanel();
        await screen.findByTestId('toolbox-row-fetch');
        await userEvent.click(screen.getByTestId('filter-plugin'));

        expect(screen.queryByTestId('toolbox-row-fetch')).toBeNull();
        expect(screen.getByTestId(`plugin-row-${pluginCatalogue[0].id}`)).toBeInTheDocument();
    });

    // What somebody actually does with a list this long: type part of a name, or part of what the
    // row says it is for.
    it('searches names and descriptions across the kinds', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({
            components: [
                componentOf({}),
                componentOf({ id: 'uv', kind: 'runtime', title: 'uv', role: 'python tools' }),
            ],
        }));

        renderPanel();
        await screen.findByTestId('toolbox-row-fetch');
        await userEvent.type(screen.getByTestId('toolbox-search'), 'python');

        expect(screen.getByTestId('toolbox-row-uv')).toBeInTheDocument();
        expect(screen.queryByTestId('toolbox-row-fetch')).toBeNull();
        expect(screen.queryByTestId(`plugin-row-${pluginCatalogue[0].id}`)).toBeNull();
    });

    it('says so when nothing matches', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf());

        renderPanel();
        await screen.findByTestId('toolbox-row-fetch');
        await userEvent.type(screen.getByTestId('toolbox-search'), 'nothing-is-called-this');

        expect(await screen.findByTestId('toolbox-empty')).toBeInTheDocument();
    });

    it('says so when the deployment installs nothing', async () => {
        (client.getToolbox as any).mockResolvedValue(toolboxOf({ enabled: false, prefix: undefined }));
        renderPanel();
        expect(await screen.findByText('This deployment installs nothing')).toBeInTheDocument();
    });
});
