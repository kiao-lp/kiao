import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileDto } from 'src/cms-core/files/service';
import { FileBasedPlugin, FileTypeConfig, LinkRenderer } from './FileBasedPlugin';

// ActivePlugin reads the current file from the browsing-persistence context.
// Stub it so tests can drive resolution with an arbitrary current file.
const nav = vi.hoisted(() => ({ currentFile: null as FileDto | null }));
vi.mock('../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: nav.currentFile, currentPath: '' }),
}));

import { PluginListProvider, usePluginListContext } from './PluginList-ctx';
import { ActivePluginProvider, useActivePluginContext } from './ActivePlugin';

const file = (path: string): FileDto => ({ path, isDirectory: false, size: 0, lastModified: 0 });

/**
 * A plugin that claims files by extension and reports its name via the config — declaring that
 * extension, as a real plugin does: `fileConfigFor` says whether it claims a file, and
 * `fileExtensions` is what a contest between two claimants is settled on.
 */
const pluginFor = (
    name: string,
    ext: string,
    extra: Partial<FileBasedPlugin> = {},
): FileBasedPlugin => {
    const config: FileTypeConfig = {
        fileLabelCmp: () => <span>{name} label</span>,
        mainView: () => <div>{name} view</div>,
    };
    return {
        fileConfigFor: (f: FileDto) => (f.path.endsWith(ext) ? config : null),
        fileExtensions: [ext],
        ...extra,
    };
};

describe('PluginList – findFilePlugin', () => {
    const FindProbe: React.FC<{ path: string }> = ({ path }) => {
        const { findFilePlugin } = usePluginListContext();
        const plugin = findFilePlugin(file(path));
        const config = plugin?.fileConfigFor(file(path)) ?? null;
        return <div data-testid="hit">{config ? React.createElement(config.mainView) : 'none'}</div>;
    };

    const renderWith = (plugins: FileBasedPlugin[], path: string) =>
        render(
            <PluginListProvider plugins={plugins}>
                <FindProbe path={path} />
            </PluginListProvider>,
        );

    it('returns the plugin whose fileConfigFor matches', () => {
        renderWith([pluginFor('md', '.md'), pluginFor('json', '.json')], 'notes.json');
        expect(screen.getByTestId('hit').textContent).toBe('json view');
    });

    it('returns null when no plugin matches', () => {
        renderWith([pluginFor('md', '.md')], 'photo.png');
        expect(screen.getByTestId('hit').textContent).toBe('none');
    });

    // The rule that replaced the hand-sorted PLUGINS list: what a plugin declares decides, and
    // where it sits in the list decides nothing. Each case is asserted in both orders, because
    // passing in only one of them is exactly what a positional rule would also do.
    it('gives the file to the longest declared suffix, whatever the order', () => {
        renderWith([pluginFor('md', '.md'), pluginFor('archdia', '.arch.md')], 'a.arch.md');
        expect(screen.getByTestId('hit').textContent).toBe('archdia view');
    });

    it('gives the file to the longest declared suffix, listed the other way round', () => {
        renderWith([pluginFor('archdia', '.arch.md'), pluginFor('md', '.md')], 'a.arch.md');
        expect(screen.getByTestId('hit').textContent).toBe('archdia view');
    });

    it('lets any specific claimant beat a fallback one, whatever the order', () => {
        // code-edit claims every `.json`; a `.mmap.json` is a mindmap. Neither suffix decides
        // this — `.json` and `.mmap.json` are claims of a different kind — so the tier does.
        const code = pluginFor('code', '.json', { fallback: true });
        renderWith([code, pluginFor('mindmap', '.mmap.json')], 'a.mmap.json');
        expect(screen.getByTestId('hit').textContent).toBe('mindmap view');
    });

    it('lets any specific claimant beat a fallback one, listed the other way round', () => {
        const code = pluginFor('code', '.json', { fallback: true });
        renderWith([pluginFor('mindmap', '.mmap.json'), code], 'a.mmap.json');
        expect(screen.getByTestId('hit').textContent).toBe('mindmap view');
    });

    it('falls back when no specific plugin claims the file', () => {
        renderWith(
            [pluginFor('code', '.json', { fallback: true }), pluginFor('mindmap', '.mmap.json')],
            'plain.json',
        );
        expect(screen.getByTestId('hit').textContent).toBe('code view');
    });

    it('takes the longest suffix among fallbacks too', () => {
        renderWith(
            [pluginFor('text', '.txt', { fallback: true }), pluginFor('backup', '.bak.txt', { fallback: true })],
            'a.bak.txt',
        );
        expect(screen.getByTestId('hit').textContent).toBe('backup view');
    });

    it('browses a directory whose name ends in a claimed suffix', () => {
        // A folder called `archive.mmap.json/` is a folder. The browser claims it on isDirectory
        // and declares no suffix; the mindmap's `.mmap.json` must not outrank that.
        const browser: FileBasedPlugin = {
            fileConfigFor: (f: FileDto) => (f.isDirectory
                ? { fileLabelCmp: () => <span>folder</span>, mainView: () => <div>browser view</div> }
                : null),
        };
        const folder: FileDto = { path: 'archive.mmap.json', isDirectory: true, size: 0, lastModified: 0 };
        const Probe: React.FC = () => {
            const { findFilePlugin } = usePluginListContext();
            const config = findFilePlugin(folder)?.fileConfigFor(folder) ?? null;
            return <div data-testid="hit">{config ? React.createElement(config.mainView) : 'none'}</div>;
        };
        render(
            <PluginListProvider plugins={[pluginFor('mindmap', '.mmap.json'), browser]}>
                <Probe />
            </PluginListProvider>,
        );
        expect(screen.getByTestId('hit').textContent).toBe('browser view');
    });

    it('lets a plugin claim a file it declared no suffix for', () => {
        // text-edit opens the store's `.kiao-files` marker, which it deliberately keeps out of
        // `fileExtensions` so the rename modal does not treat the whole name as an extension.
        const marker = pluginFor('marker', '.kiao-files', { fileExtensions: [] });
        renderWith([pluginFor('md', '.md'), marker], '.kiao-files');
        expect(screen.getByTestId('hit').textContent).toBe('marker view');
    });
});

describe('PluginList – customLinkRenderers', () => {
    const RendererProbe: React.FC = () => {
        const { customLinkRenderers } = usePluginListContext();
        return <div data-testid="keys">{Object.keys(customLinkRenderers).sort().join(',')}</div>;
    };

    const noop: LinkRenderer = () => null;

    it('merges markdownRenderers from every plugin', () => {
        const plugins = [
            pluginFor('a', '.a', { markdownRenderers: { unit: noop } }),
            pluginFor('b', '.b', { markdownRenderers: { graph: noop } }),
            pluginFor('c', '.c'), // no renderers
        ];
        render(
            <PluginListProvider plugins={plugins}>
                <RendererProbe />
            </PluginListProvider>,
        );
        expect(screen.getByTestId('keys').textContent).toBe('graph,unit');
    });
});

describe('ActivePlugin – resolves the plugin for the current file', () => {
    const ActiveProbe: React.FC = () => {
        const { activePlugin, activeFileConfig } = useActivePluginContext();
        return (
            <div data-testid="active">
                {activePlugin && activeFileConfig
                    ? React.createElement(activeFileConfig.mainView)
                    : 'null'}
            </div>
        );
    };

    const renderActive = (plugins: FileBasedPlugin[]) =>
        render(
            <PluginListProvider plugins={plugins}>
                <ActivePluginProvider>
                    <ActiveProbe />
                </ActivePluginProvider>
            </PluginListProvider>,
        );

    beforeEach(() => { nav.currentFile = null; });

    it('exposes the matching plugin and its config', () => {
        nav.currentFile = file('doc.md');
        renderActive([pluginFor('md', '.md'), pluginFor('json', '.json')]);
        expect(screen.getByTestId('active').textContent).toBe('md view');
    });

    it('is null when there is no current file', () => {
        nav.currentFile = null;
        renderActive([pluginFor('md', '.md')]);
        expect(screen.getByTestId('active').textContent).toBe('null');
    });

    it('is null when no plugin matches the current file', () => {
        nav.currentFile = file('photo.png');
        renderActive([pluginFor('md', '.md')]);
        expect(screen.getByTestId('active').textContent).toBe('null');
    });
});
