// Store configuration selects from the build-time catalogue before first render.
// Unloaded file plugins fall back through resolveFilePlugin to code-edit/text-edit.

import { CATALOGUE, SOURCES } from 'virtual:kiao-plugin-assembly';
import type { CmsPlugin } from '../FileBasedPlugin';

export interface PluginCatalogueEntry {
    id: string;
    title: string;
    description: string;
}

/** Build-time catalogue; stores select which plugins to load. */
export const pluginCatalogue: PluginCatalogueEntry[] = CATALOGUE;

/** Bundles externalize shared imports to the shell’s import map; see vite-plugins/assembly.ts. */
const bundleUrl = (id: string) => `${import.meta.env.BASE_URL}plugins/${id}/index.js`;

/** Built CSS is separate from the module; link it once before importing. */
const linkStylesheet = (id: string) => {
    const href = `${import.meta.env.BASE_URL}plugins/${id}/style.css`;
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
};

const loadModule = async (id: string): Promise<unknown> => {
    // Dev and vitest load source because built bundles are unavailable.
    const fromSource = SOURCES[id];
    if (fromSource) return fromSource();
    linkStylesheet(id);
    return import(/* @vite-ignore */ bundleUrl(id));
};

export interface LoadedAssembly {
    plugins: CmsPlugin[];
    /** Ids the store asked for that this build does not carry, or whose module would not load. */
    missing: string[];
}

/** Preserves requested order; unavailable or failed plugins are reported and skipped. */
export const loadPluginAssembly = async (ids: string[]): Promise<LoadedAssembly> => {
    const known = new Set(pluginCatalogue.map(entry => entry.id));
    const missing = ids.filter(id => !known.has(id));

    const loaded = await Promise.all(ids.filter(id => known.has(id)).map(async id => {
        try {
            const module = await loadModule(id) as { plugin?: CmsPlugin };
            if (!module.plugin) throw new Error(`no 'plugin' export`);
            return module.plugin;
        } catch (error) {
            console.error(`Dashboard: the plugin '${id}' could not be loaded`, error);
            missing.push(id);
            return null;
        }
    }));

    return { plugins: loaded.filter((plugin): plugin is CmsPlugin => plugin !== null), missing };
};
