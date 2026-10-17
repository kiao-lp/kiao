import { useCallback, useMemo } from 'react';
import { FileDto } from 'src/cms-core/files/service';
import { createSimpleContext } from 'react-concise';
import { FileBasedPlugin, LinkRenderer } from './FileBasedPlugin';
import type { SideDocumentDeclaration } from '../side-documents/sideDocumentModel';

export type PluginListProps = {
  plugins: FileBasedPlugin[];
};

export type PluginListValue = {
  findFilePlugin: (currentFile: FileDto) => FileBasedPlugin | null;
  plugins: FileBasedPlugin[];
  customLinkRenderers: Record<string, LinkRenderer>;
  /**
   * Every extension any plugin declares, longest first — the suffixes generic file UX keeps
   * intact in a name. Pooled rather than read off the plugin that claims the file, because the
   * two are not always the same: `.arch.md` is declared by archdia-edit and `.md` by
   * markdown-edit, and a `.arch.md` must keep the whole of its suffix.
   *
   * Longest first is what makes that work under `endsWith`, and it is a property of the
   * extensions rather than of the list they came from — so, like `findFilePlugin`, this does not
   * care what order the plugins were registered in.
   */
  knownExtensions: string[];
  /** Every side document any plugin offers, in registration order. */
  sideDocuments: SideDocumentDeclaration[];
  /**
   * What the loaded plugins publish for each other, gathered under the names they declared — **every
   * publisher of a name, not one of them**. Read through `@cms-kit/capabilities`, which is where
   * those names and their types live; a name nothing published is simply absent, which is how a
   * consumer learns to do without.
   */
  capabilities: Record<string, unknown[]>;
};

const defaultValue: PluginListValue = {
  plugins: [],
  findFilePlugin: () => null,
  customLinkRenderers: {},
  knownExtensions: [],
  sideDocuments: [],
  capabilities: {},
};

/**
 * How specifically a plugin claims this file: the length of the longest extension it declares
 * that the file's name ends with, or 0 when it claims the file without declaring a suffix for it.
 * Matched case-insensitively, as the viewers that claim `.PNG` and `.JPG` do.
 */
const claimStrength = (plugin: FileBasedPlugin, path: string): number => {
  const lower = path.toLowerCase();
  return (plugin.fileExtensions ?? [])
    .filter(extension => lower.endsWith(extension.toLowerCase()))
    .reduce((longest, extension) => Math.max(longest, extension.length), 0);
};

/**
 * The plugin that opens a file — the most specific of those willing to.
 *
 * `fileConfigFor` says *whether* a plugin claims the file; this says which claim wins when more
 * than one does. A specific claim beats a fallback one (`.mmap.json` over `code-edit`'s `.json`),
 * and between claims of the same kind the longer suffix wins (`.arch.md` over `.md`). Registration
 * order settles nothing, which is what lets `PLUGINS` stop being a hand-sorted list.
 */
export const resolveFilePlugin = (
  plugins: FileBasedPlugin[], currentFile: FileDto,
): FileBasedPlugin | null => {
  const claimants = plugins.filter(plugin => plugin.fileConfigFor(currentFile) !== null);

  // A directory is browsed, whatever it is called: `archive.mmap.json/` is a folder, not a
  // mindmap. The folder browser claims a directory *as* one — on `isDirectory`, declaring no
  // suffix — so its claim is taken over any suffix that happens to match the folder's name. This
  // is the whole of what the folder browser heading the old hand-sorted list meant.
  const byKind = currentFile.isDirectory
    ? claimants.filter(plugin => claimStrength(plugin, currentFile.path) === 0)
    : [];

  return (byKind.length ? byKind : claimants)
    .reduce<FileBasedPlugin | null>((best, plugin) => {
      if (!best) return plugin;
      if (!!best.fallback !== !!plugin.fallback) return best.fallback ? plugin : best;
      return claimStrength(plugin, currentFile.path) > claimStrength(best, currentFile.path)
        ? plugin : best;
    }, null);
};

const usePluginList: (props: PluginListProps) => PluginListValue = ({ plugins }) => {

  const findFilePlugin = useCallback(
    (currentFile: FileDto) => resolveFilePlugin(plugins, currentFile), [plugins]);

  const customLinkRenderers = useMemo(() => {
    return plugins.reduce((acc, plugin) => {
      if (plugin.markdownRenderers) {
        return { ...acc, ...plugin.markdownRenderers };
      }
      return acc;
    }, {} as Record<string, LinkRenderer>);
  }, [plugins]);

  const knownExtensions = useMemo(
    () => plugins
      .flatMap(plugin => plugin.fileExtensions ?? [])
      .sort((a, b) => b.length - a.length),
    [plugins]);

  const sideDocuments = useMemo(
    () => plugins.flatMap(plugin => plugin.sideDocuments ?? []),
    [plugins]);

  // Every publisher of a name, in assembly order — not the last one to be merged in. Two plugins
  // may offer the same capability (two chats, two taggers), and a registry that kept one of them
  // would drop the other silently, which is the one failure a consumer could never see.
  const capabilities = useMemo(
    () => plugins.reduce<Record<string, unknown[]>>((acc, plugin) => {
      for (const [name, value] of Object.entries(plugin.capabilities ?? {})) {
        (acc[name] ??= []).push(value);
      }
      return acc;
    }, {}),
    [plugins]);

  return { findFilePlugin, plugins, customLinkRenderers, knownExtensions, sideDocuments, capabilities };
}

const hookBasedContext = createSimpleContext(usePluginList, defaultValue);

export const PluginListProvider = hookBasedContext.Provider;
export const usePluginListContext = hookBasedContext.useContext;

/**
 * What the loaded plugins published for each other, **one list per name**: every publisher of it, in
 * the order the assembly loaded them. Exposed on the façade so a plugin reads it without the whole
 * plugin list; the names and their types are `@cms-kit/capabilities`'.
 *
 * A name nobody published is absent rather than empty, which is what lets a consumer tell "no plugin
 * in this assembly does that" from "one does, and it has nothing to offer".
 */
export const usePluginCapabilities = (): Record<string, unknown[]> =>
  hookBasedContext.useContext().capabilities;
