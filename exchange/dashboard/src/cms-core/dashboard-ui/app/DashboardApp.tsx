import React, { useMemo } from 'react';
import { BrowserRouter } from "react-router-dom";
import { ConfigProvider } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import { PointedElementContextProvider } from 'react-advanced-interactions';
import { kiaoAntTheme } from 'kiao-style';
import type { WorkerClient } from 'kiao-worker';
import { WorkerClientProvider } from 'src/cms-core/files/service/ui';
import { CmsPlugin, VoiceInputProvider } from '@cms-core';
import { AppRoutesProvider } from '../../app-routes';
import { AppRouteView } from '../layout/AppRouteView';
import { ToolBarsProvider, ToolBarTabRegistration } from '../toolbars/ToolBars-ctx';
import { fileNavigationTreeTab } from '../../files/nav-bar/fileNavigationTab';
import { agentProfilesTab, toolboxTab } from '../../toolbox';
import { lazyComponent } from '../../ui-foundation/react/lazyComponent';
import { GitSyncMonitor } from '../../git/GitSyncMonitor';
import { GitDiffProvider } from '../../git/GitDiff-ctx';
import { ToolsMenuProvider } from '../top-banner/ToolsMenu-ctx';
import { DashboardConfigProvider, useDashboardConfig } from '../../config/DashboardConfig-ctx';
import { ViewStateProvider, ViewStateReady } from '../../view-state/ViewState-ctx';
import { FileBrowsingProvider } from '../../files/core/FileBrowsingProvider';
import { InternalLinkNavigator } from '../../files/navigation/InternalLinkNavigator';
import { FileTemplateCreationPlugin } from '../../files/creation/FileTemplateCreationPlugin';
import { PluginListProvider } from '../../extensibility/PluginList-ctx';
import { PluginAssemblyProvider, usePluginAssembly } from '../../extensibility/assembly';
import { ActivePluginGlobalProvider } from '../../extensibility/ActivePluginGlobalProvider';
import { ActivePluginProvider } from '../../extensibility/ActivePlugin';
import { SecondaryDocumentProvider, SecondaryDocumentReveal, secondaryDocumentTab } from '../documents/secondary';
import { HotkeyRegistryProvider } from '../../hotkeys/HotkeyRegistry-ctx';
import { HotkeyDispatcherProvider } from '../../hotkeys/HotkeyDispatcher-ctx';
import { SelectionProvider } from '../../ui-foundation/interactions/selection';
import { ZoomTargetProvider } from '../../ui-foundation/zoom';
import { useTheme } from '../../ui-foundation/theme/ThemeContext';
import { ThemePreferences } from '../preferences/ThemePreferences';
import { ActivePluginMainViewCmp } from '../documents/ActivePluginMainView';
import { UnicodeKeyboard } from '../../ui-foundation/text-input/UnicodeKeyboard';
import { plugin as folderBrowser } from '../../files/browser';
import './Dashboard.css';
import '../../styles/cms-core.css';

const GitPanelContent = lazyComponent(() => import('../../git/GitPanel').then(m => ({ default: m.GitPanelContent })));

// Plugin order sets tool bar tab order only. File resolution uses declared extensions.
const usePlugins = (): CmsPlugin[] => {
  const { plugins } = usePluginAssembly();
  return useMemo(() => [folderBrowser, ...plugins], [plugins]);
};

const AppLayout = () => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }} id="ui-root">
      <AppRouteView><ActivePluginMainViewCmp /></AppRouteView>
    </div>
  );
};

const AppRoutesFromPlugins: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const config = useDashboardConfig();
  const plugins = usePlugins();
  const routes = useMemo(
    () => plugins.filter(plugin => plugin.isEnabled?.(config) ?? true)
      .flatMap(plugin => plugin.appRoutes ?? []),
    [plugins, config],
  );
  return <AppRoutesProvider routes={routes}>{children}</AppRoutesProvider>;
};

const PluginContributions = () => {
  const config = useDashboardConfig();
  const enabledPlugins = usePlugins().filter(plugin => plugin.isEnabled?.(config) ?? true);
  return (
    <>
      {enabledPlugins.flatMap(plugin => plugin.toolBars ?? [])
        .filter(tab => tab.isEnabled?.(config) ?? true)
        .map(tab => <ToolBarTabRegistration key={tab.id} tab={tab} />)}
    </>
  );
};

const ToolsMenuFromPlugins: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const config = useDashboardConfig();
  const plugins = usePlugins();
  const items = useMemo(() => plugins
    .filter(plugin => plugin.isEnabled?.(config) ?? true)
    .flatMap(plugin => plugin.toolsMenuItems ?? [])
    .filter(item => item.isEnabled?.(config) ?? true), [plugins, config]);
  return <ToolsMenuProvider items={items}>{children}</ToolsMenuProvider>;
};

const CoreContributions = () => {
  const { gitEnabled } = useDashboardConfig();

  return (
    <>
      <ToolBarTabRegistration tab={secondaryDocumentTab} />
      <SecondaryDocumentReveal />
      <ToolBarTabRegistration tab={fileNavigationTreeTab} />
      <ToolBarTabRegistration tab={toolboxTab} />
      <ToolBarTabRegistration tab={agentProfilesTab} />
      {gitEnabled && <>
        <ToolBarTabRegistration tab={{
          id: 'git',
          title: 'Git',
          icon: <BranchesOutlined />,
          render: () => <GitPanelContent />,
        }} />
        <GitSyncMonitor />
      </>}
    </>
  );
};

const CreationProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>{usePlugins().reduceRight<React.ReactNode>(
    (acc, p) => {
      const Provider = p.CreationProvider;
      return Provider ? <Provider key={p.id}>{acc}</Provider> : acc;
    },
    children,
  )}</>
);

export const PluginProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>{usePlugins().reduceRight<React.ReactNode>(
    (acc, p) => (p.providers ?? []).reduceRight<React.ReactNode>(
      (inner, Provider, index) => <Provider key={`${p.id}-${index}`}>{inner}</Provider>,
      acc,
    ),
    children,
  )}</>
);

const ThemeWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useTheme();
  const antdTheme = kiaoAntTheme(theme);
  return <ConfigProvider theme={antdTheme} popupMatchSelectWidth={false}>{children}</ConfigProvider>;
};

type ProviderComponent = React.FC<{ children: React.ReactNode }>;

const composeProviders = (providers: ProviderComponent[], children: React.ReactNode): React.ReactNode =>
  providers.reduceRight<React.ReactNode>((acc, Provider) => <Provider>{acc}</Provider>, children);

const RouterProvider: ProviderComponent = ({ children }) => (
  <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/+$/, '')} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    {children}
  </BrowserRouter>
);

const PluginRegistryProvider: ProviderComponent = ({ children }) => (
  <PluginListProvider plugins={usePlugins()}>{children}</PluginListProvider>
);

// The app's context stack, outermost first.
const APP_PROVIDERS: ProviderComponent[] = [
  RouterProvider,
  PluginRegistryProvider,
  SecondaryDocumentProvider,
  PointedElementContextProvider,
  SelectionProvider,
  ZoomTargetProvider,
  HotkeyRegistryProvider,
  VoiceInputProvider,
  AppRoutesFromPlugins,
  FileBrowsingProvider,
  ActivePluginProvider,
  CreationProviders,
  FileTemplateCreationPlugin,
  HotkeyDispatcherProvider,
  PluginProviders,
  ToolBarsProvider,
  GitDiffProvider,
  ToolsMenuFromPlugins,
];

// Theme preferences require the worker client and loaded view state.
export const DashboardApp: React.FC<{ workerClient: WorkerClient }> = ({ workerClient }) => (
  <WorkerClientProvider workerClient={workerClient}>
    <ViewStateProvider waitForLoad={false}>
      <DashboardConfigProvider>
        <PluginAssemblyProvider>
          <ViewStateReady>
            <ThemePreferences>
              <ThemeWrapper>
                <UnicodeKeyboard />
                {composeProviders(APP_PROVIDERS, (
                  <>
                    <InternalLinkNavigator />
                    {/* Core first: browsing the store heads the Show menu, before what a plugin adds. */}
                    <CoreContributions />
                    <PluginContributions />
                    <ActivePluginGlobalProvider>
                      <AppLayout />
                    </ActivePluginGlobalProvider>
                  </>
                ))}
              </ThemeWrapper>
            </ThemePreferences>
          </ViewStateReady>
        </PluginAssemblyProvider>
      </DashboardConfigProvider>
    </ViewStateProvider>
  </WorkerClientProvider>
);
