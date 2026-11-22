import { useMemo } from 'react';
import { useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';
import { createSimpleContext } from 'react-concise';
import { usePluginListContext } from './PluginList-ctx';
import { FileBasedPlugin, FileTypeConfig } from './FileBasedPlugin';

export type ActivePluginProps = {};

export type ActivePluginValue = {
  activePlugin: FileBasedPlugin | null;
  activeFileConfig: FileTypeConfig | null;
};

const defaultValue: ActivePluginValue = {
  activePlugin: null,
  activeFileConfig: null
};

const useActivePlugin: (props: ActivePluginProps) => ActivePluginValue = () => {

  const { findFilePlugin } = usePluginListContext();
  const { currentFile } = useFileBrowsingPersistenceContext();

  const [activePlugin, activeFileConfig] = useMemo(() => {
    if (!currentFile || !findFilePlugin(currentFile)) {
      return [null, null];
    }

    const plugin = findFilePlugin(currentFile);
    const config = plugin!.fileConfigFor(currentFile);



    return [plugin, config];
  }, [currentFile, findFilePlugin])

  return { activePlugin, activeFileConfig };
}

const hookBasedContext = createSimpleContext(useActivePlugin, defaultValue);

export const ActivePluginProvider = hookBasedContext.Provider;
export const useActivePluginContext = hookBasedContext.useContext;
