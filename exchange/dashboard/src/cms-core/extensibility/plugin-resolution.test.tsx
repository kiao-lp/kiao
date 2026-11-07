import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileDto } from 'src/cms-core/files/service';
import { CmsPlugin, FileBasedPlugin, FileTypeConfig, LinkRenderer } from './FileBasedPlugin';

// Stub: tests set the current file directly.
const nav = vi.hoisted(() => ({ currentFile: null as FileDto | null }));
vi.mock('../files/core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => ({ currentFile: nav.currentFile, currentPath: '' }),
}));

import { PluginListProvider, resolveFilePlugin, usePluginListContext } from './PluginList-ctx';
import { ActivePluginProvider, useActivePluginContext } from './ActivePlugin';

const file = (path: string): FileDto => ({ path, isDirectory: false, size: 0, lastModified: 0 });

/** Claims by extension; reports name via config. */
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

    const renderWith = (plugins: Partial<FileBasedPlugin>[], path: string) =>
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

    it('returns null when only file-less plugins are loaded', () => {
        const panels: CmsPlugin = { id: 'panels' };
        renderWith([panels], 'notes.md');
        expect(screen.getByTestId('hit').textContent).toBe('none');
    });

    it.each([true, false])('ignores file-less plugins regardless of order (first: %s)', first => {
        const panels: CmsPlugin = { id: 'panels', fileExtensions: ['.arch.md'] };
        const editor = pluginFor('md', '.md', { fallback: true });
        const plugins = first ? [panels, editor] : [editor, panels];
        expect(resolveFilePlugin(plugins, file('notes.arch.md'))).toBe(editor);
    });

    it('ignores file-less plugins for directories', () => {
        const panels: CmsPlugin = { id: 'panels' };
        expect(resolveFilePlugin([panels], { ...file('folder'), isDirectory: true })).toBeNull();
    });

    // Longest suffix wins; order does not matter — both orders asserted.
    it('gives the file to the longest declared suffix, whatever the order', () => {
        renderWith([pluginFor('md', '.md'), pluginFor('archdia', '.arch.md')], 'a.arch.md');
        expect(screen.getByTestId('hit').textContent).toBe('archdia view');
    });

    it('gives the file to the longest declared suffix, listed the other way round', () => {
        renderWith([pluginFor('archdia', '.arch.md'), pluginFor('md', '.md')], 'a.arch.md');
        expect(screen.getByTestId('hit').textContent).toBe('archdia view');
    });

    it('lets any specific claimant beat a fallback one, whatever the order', () => {
        // Specific claimant beats fallback regardless of suffix.
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
        // Directory claim (no suffix) outranks suffix claims.
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
        // No suffix declared, so rename does not treat the name as an extension.
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
        const panels: CmsPlugin = { id: 'panels', markdownRenderers: { graph: noop } };
        const plugins = [
            pluginFor('a', '.a', { markdownRenderers: { unit: noop } }),
            panels,
            pluginFor('c', '.c'),
        ];
        render(
            <PluginListProvider plugins={plugins}>
                <RendererProbe />
            </PluginListProvider>,
        );
        expect(screen.getByTestId('keys').textContent).toBe('graph,unit');
    });
});

describe('PluginList – capabilities', () => {
    it('keeps capabilities from file-less plugins', () => {
        const feature = { run: vi.fn() };
        const panels: CmsPlugin = { id: 'panels', capabilities: { 'feature.run': feature } };
        let capabilities: Record<string, unknown[]> = {};
        const Probe = () => {
            capabilities = usePluginListContext().capabilities;
            return null;
        };
        render(<PluginListProvider plugins={[panels]}><Probe /></PluginListProvider>);
        expect(capabilities['feature.run']).toEqual([feature]);
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

    const renderActive = (plugins: Partial<FileBasedPlugin>[]) =>
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
        const panels: CmsPlugin = { id: 'panels' };
        renderActive([panels, pluginFor('md', '.md'), pluginFor('json', '.json')]);
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

    it('is null when the loaded plugins provide no file handlers', () => {
        nav.currentFile = file('doc.md');
        const panels: CmsPlugin = { id: 'panels' };
        renderActive([panels]);
        expect(screen.getByTestId('active').textContent).toBe('null');
    });
});
