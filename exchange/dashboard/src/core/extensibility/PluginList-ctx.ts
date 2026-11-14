import { useCallback, useMemo } from 'react';
import { FileDto } from 'src/core/files/service';
import { createSimpleContext } from 'react-concise';
import { FileBasedPlugin, LinkRenderer } from './FileBasedPlugin';

export type PluginListProps = {
  plugins: Partial<FileBasedPlugin>[];
};

export type PluginListValue = {
  findFilePlugin: (currentFile: FileDto) => FileBasedPlugin | null;
  plugins: Partial<FileBasedPlugin>[];
  customLinkRenderers: Record<string, LinkRenderer>;
  /** All declared extensions, longest first. Longest-first makes `.arch.md` win over `.md` under endsWith. */
  knownExtensions: string[];
  /** All publishers per name, in assembly order. Absent name means no publisher. */
  capabilities: Record<string, unknown[]>;
};

const defaultValue: PluginListValue = {
  plugins: [],
  findFilePlugin: () => null,
  customLinkRenderers: {},
  knownExtensions: [],
  capabilities: {},
};

/** Longest declared suffix matching the path, or 0. Case-insensitive. */
const claimStrength = (plugin: FileBasedPlugin, path: string): number => {
  const lower = path.toLowerCase();
  return (plugin.fileExtensions ?? [])
    .filter(extension => lower.endsWith(extension.toLowerCase()))
    .reduce((longest, extension) => Math.max(longest, extension.length), 0);
};

/** Most specific claimant wins; fallbacks lose to specific claims. Registration order decides nothing. */
export const resolveFilePlugin = (
  plugins: Partial<FileBasedPlugin>[], currentFile: FileDto,
): FileBasedPlugin | null => {
  const claimants = plugins.filter((plugin): plugin is FileBasedPlugin =>
    plugin.fileConfigFor?.(currentFile) != null);

  // Directories claim on isDirectory with strength 0, outranking name suffixes.
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

  // Keep every publisher in assembly order; dropping one is invisible to consumers.
  const capabilities = useMemo(
    () => plugins.reduce<Record<string, unknown[]>>((acc, plugin) => {
      for (const [name, value] of Object.entries(plugin.capabilities ?? {})) {
        (acc[name] ??= []).push(value);
      }
      return acc;
    }, {}),
    [plugins]);

  return { findFilePlugin, plugins, customLinkRenderers, knownExtensions, capabilities };
}

const hookBasedContext = createSimpleContext(usePluginList, defaultValue);

export const PluginListProvider = hookBasedContext.Provider;
export const usePluginListContext = hookBasedContext.useContext;

export const usePluginCapabilities = (): Record<string, unknown[]> =>
  hookBasedContext.useContext().capabilities;
