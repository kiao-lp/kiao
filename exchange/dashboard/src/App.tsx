import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { BrowserRouter } from "react-router-dom";

// 3rd Party Libraries
import { ConfigProvider } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import { AuthProvider, useAuth } from "react-oidc-context";
import { PointedElementContextProvider } from 'react-advanced-interactions';
import { kiaoAntTheme } from 'kiao-style';

// Domain / Services
import { WorkerClient } from 'kiao-worker';
import { WorkerClientProvider } from 'src/cms-core/files/service/ui';

// Core CMS Providers
import { CmsPlugin, VoiceInputProvider } from '@cms-core';
import { AppRoutesProvider } from './cms-core/app-routes';
import { AppRouteView } from './cms-core/app-routes/AppRouteView';
import { ToolBarsProvider, ToolBarTabRegistration } from './cms-core/tool-bars/ToolBars-ctx';
import { fileNavigationTreeTab } from './cms-core/files/nav-bar/fileNavigationTab';
import { agentProfilesTab, toolboxTab } from './cms-core/toolbox';
import { lazyComponent } from './cms-core/core/lazyComponent';
import { GitSyncMonitor } from './cms-core/toolbar/GitSyncMonitor';
import { GitDiffProvider } from './cms-core/toolbar/GitDiff-ctx';
import { FileOptimizationsProvider } from './cms-core/file-optimizations';
import { DashboardConfigProvider, useDashboardConfig } from './cms-core/config/DashboardConfig-ctx';
import { ViewStateProvider, ViewStateReady } from './cms-core/view-state/ViewState-ctx';
import { FileBrowsingProvider } from './cms-core/files/core/FileBrowsingProvider';
import { InternalLinkNavigator } from './cms-core/files/navigation/InternalLinkNavigator';
import { FileTemplateCreationPlugin } from './cms-core/files/creation/FileTemplateCreationPlugin';
import { PluginListProvider } from './cms-core/core/PluginList-ctx';
import { PluginAssemblyProvider, usePluginAssembly } from './cms-core/core/assembly';
import { ActivePluginGlobalProvider } from './cms-core/core/ActivePluginGlobalProvider';
import { ActivePluginProvider } from './cms-core/core/ActivePlugin';
import { SecondaryDocumentProvider, SecondaryDocumentReveal, secondaryDocumentTab } from './cms-core/secondary-document';
import { HotkeyRegistryProvider } from './cms-core/commands/HotkeyRegistry-ctx';
import { HotkeyDispatcherProvider } from './cms-core/commands/HotkeyDispatcher-ctx';
import { SelectionProvider } from './cms-core/selection';
import { ZoomTargetProvider } from './cms-core/zoom';
import { ThemeProvider, useTheme } from './ThemeContext';
import { markInternalNavigation } from './cms-core/lib/internal-navigation';
import {
  ACTION_TOKEN_MIN_LIFE_SECONDS,
  ensureTokenLife,
  recoverSession,
  type RecoveryOutcome,
} from './cms-core/auth/sessionRecovery';
import { securityEnabled } from './cms-core/auth/authToken';

// UI Components
import { ActivePluginMainViewCmp } from './cms-core/core/ActivePluginMainView';

import { UnicodeKeyboard } from './UnicodeKeyboard';

// The folder browser is cms-core's own — every store is browsed, whatever it is assembled with —
// so it is imported here and heads the list. Every other plugin is loaded at startup from the
// store's own configuration; see `cms-core/core/assembly/`.
import { plugin as folderBrowser } from './cms-core/files/browser';

// Styles
import './App.css';
import './cms-core/styles/cms-core.css';

// --- Configuration & Constants ---

// Where the app is mounted, taken from the value Vite was built with (VITE_BASE_PATH, default
// '/dashboard/') rather than restated here: the router basename, the OIDC redirect and the
// resolution of stored links must all name the same place, and one of them drifting is a class of
// bug with no symptom until deployment.
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, '');

const GitPanelContent = lazyComponent(() => import('./cms-core/toolbar/GitPanel').then(m => ({ default: m.GitPanelContent })));

// The plugin registry, as this store is assembled: the folder browser, then whatever
// `.kiao-config/dashboard.json` named, loaded before the first render.
//
// Order is *not* load-bearing for file resolution: which plugin opens a document is settled by
// what each one declares — the longest matching `fileExtensions` suffix wins, and a
// `fallback: true` plugin (code-edit, text-edit) is looked at only once every specific claimant
// has passed. See `resolveFilePlugin` in cms-core/core/PluginList-ctx. Order decides the order
// tool bar tabs are offered in, and nothing else.
const usePlugins = (): CmsPlugin[] => {
  const { plugins } = usePluginAssembly();
  return useMemo(() => [folderBrowser, ...plugins], [plugins]);
};

const oidcConfig = {
  // The realm this instance logs into. A secured deployment names its own at build time;
  // the fallback is a Keycloak on the loopback address and nothing more.
  authority: import.meta.env.VITE_OIDC_AUTHORITY || "http://localhost:8080/realms/kiao",
  client_id: "dashboard",
  redirect_uri: window.location.origin + BASE_PATH,
  // A bare page whose only job is to hand the response back — see public/silent-renew.html.
  // Left unset, oidc-client-ts renews through `redirect_uri`, booting a whole second Dashboard
  // in the hidden frame.
  silent_redirect_uri: window.location.origin + BASE_PATH + '/silent-renew.html',
  automaticSilentRenew: true,
  onSigninCallback: (_user: any) => {
    const returnPath = _user?.state?.returnPath;
    // Navigate directly to the return path, or to base path if none
    const targetPath = returnPath || BASE_PATH;
    window.history.replaceState({}, document.title, targetPath);
  }
};

// --- Helper Components ---

const AppLayout = () => {
  // The height is `App.css`'s: the frame fills the window and clips, and never grows past it.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }} id="ui-root">
      <AppRouteView><ActivePluginMainViewCmp /></AppRouteView>
    </div>
  );
};

// Tool bar declarations come from the plugin registry. Rendered below
// DashboardConfigProvider so runtime config can gate a plugin.
// Publishes every enabled plugin's claimed URL prefixes. A separate provider from
// PluginContributions because a page has to be reachable from the layout, which sits above the tool
// bar registrations rather than beside them.
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

// cms-core's own tool bar tabs: browsing the store, which every document offers, and Git, which
// owns the application-level diff mode and so remains a cms-core integration rather than
// advertising a plugin boundary it does not yet have.
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

// Composes every plugin's optional CreationProvider into one nested stack — the
// programmatic replacement for the old hand-nested *CreationPlugin pyramid. Each wrapper
// registers a "New …" command and renders its children unchanged; the creation menu is
// ordered by each command's `order`, not by nesting, so PLUGINS order is not load-bearing
// here (reduceRight keeps the first plugin outermost, matching the old top-down nesting).
const CreationProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>{usePlugins().reduceRight<React.ReactNode>(
    (acc, p) => {
      const Provider = p.CreationProvider;
      return Provider ? <Provider key={p.id}>{acc}</Provider> : acc;
    },
    children,
  )}</>
);

// Composes every plugin's optional app-level `providers` into one nested stack, the same way
// CreationProviders composes the creation wrappers: reduceRight keeps the first plugin outermost,
// and a plugin's own list nests in declaration order. What these buy a plugin is lifetime — they
// are mounted once for the life of the app, so a plugin's state survives navigation between
// documents of different types, which nothing rendered from a main view or a toolbar panel does
// (each main view brings its own <LayoutContent>, hence its own tool bars).
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
  // A select's box hugs its value (see cms-core.css: no arrow, no width of its own), so matching
  // the popup to the box would clip every item down to its own padding. Sized by its own content
  // instead, the list is as wide as what is in it — the mindmap note toolbar's behaviour, as the
  // default for every select.
  return <ConfigProvider theme={antdTheme} popupMatchSelectWidth={false}>{children}</ConfigProvider>;
};

// --- Main Application Structure ---

type ProviderComponent = React.FC<{ children: React.ReactNode }>;

// Nest an ordered list of providers around `children`: the first entry is the
// outermost wrapper, the last the innermost. Order is behavior — see APP_PROVIDERS.
const composeProviders = (providers: ProviderComponent[], children: React.ReactNode): React.ReactNode =>
  providers.reduceRight<React.ReactNode>((acc, Provider) => <Provider>{acc}</Provider>, children);

// BrowserRouter and PluginListProvider need fixed props; bind them once here so
// APP_PROVIDERS stays a plain list of <FC<{children}>>.
const RouterProvider: ProviderComponent = ({ children }) => (
  <BrowserRouter basename={BASE_PATH} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    {children}
  </BrowserRouter>
);

const PluginRegistryProvider: ProviderComponent = ({ children }) => (
  <PluginListProvider plugins={usePlugins()}>{children}</PluginListProvider>
);

// The app's context stack, outermost first. ORDER IS LOAD-BEARING:
//  - PluginRegistryProvider before ActivePluginProvider — ActivePlugin resolves against the plugin list.
//  - FileBrowsingProvider before ActivePluginProvider — ActivePlugin reads the current file from it.
//  - ActivePluginGlobalProvider wraps AppLayout below this stack: file-specific contexts must not
//    remount app providers or contributions when the document type changes.
//  - PluginProviders below the hotkey dispatcher so a plugin provider may register hotkeys, and above
//    ToolBarsProvider so a panel consuming one is its consumer and never its owner.
//  - GitDiffProvider and FileOptimizationsProvider innermost — LayoutContent's stack followers
//    read both to push an application mode over the showing view, and the top banner reads the
//    second to offer it.
// WorkerClientProvider, DashboardConfigProvider and PluginAssemblyProvider stay explicit in MainApp's
// layout tree: UnicodeKeyboard is their sibling, WorkerClientProvider carries the request client,
// and the two gates read in the order they resolve — the config says which plugins, the assembly
// loads them, and only then is there a list for the stack below to be built from.
const APP_PROVIDERS: ProviderComponent[] = [
  RouterProvider,
  PluginRegistryProvider,
  SecondaryDocumentProvider,
  PointedElementContextProvider,
  SelectionProvider,
  ZoomTargetProvider,
  HotkeyRegistryProvider,
  VoiceInputProvider,
  // Above FileBrowsingProvider on purpose: that provider resolves the pathname against the file
  // store, and it asks this one first whether the pathname is a page rather than a path.
  AppRoutesFromPlugins,
  FileBrowsingProvider,
  ActivePluginProvider,
  CreationProviders,
  // FileTemplateCreationPlugin is a cms-core feature (kiao-user-config/file-templates), sitting
  // just inside the plugin creation wrappers as the innermost creation registration.
  FileTemplateCreationPlugin,
  HotkeyDispatcherProvider,
  PluginProviders,
  ToolBarsProvider,
  GitDiffProvider,
  FileOptimizationsProvider,
];

// ThemeProvider lives here rather than at the root because the theme is stored in
// the file store: it needs the files client and the resolved view state above it.
const MainApp: React.FC<{ workerClient: WorkerClient }> = ({ workerClient }) => (
  <WorkerClientProvider workerClient={workerClient}>
    <ViewStateProvider waitForLoad={false}>
      <DashboardConfigProvider>
        <PluginAssemblyProvider>
          <ViewStateReady>
            <ThemeProvider>
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
            </ThemeProvider>
          </ViewStateReady>
        </PluginAssemblyProvider>
      </DashboardConfigProvider>
    </ViewStateProvider>
  </WorkerClientProvider>
);

// --- Data & Auth Layers ---

// The endpoint a file action runs through. It is the one call the CMS makes that the server may
// spend minutes serving, and the only one worth renewing the token for before it goes out.
const ACTION_RUN_PATH = "/actions/run";

// Builds the WorkerClient for /api/files. Without a token provider (no-security dev
// mode) requests go out unauthenticated; with one, every request and the metadata
// header hook carry the current bearer token — read live, so token refreshes apply.
// Exported for the test that pins which calls wait for a fresh token, and which do not.
export const createWorkerClient = (
  getToken?: () => string | undefined,
  freshenToken?: () => Promise<void>,
): WorkerClient => {
  const baseUrl = new URL(`/api/files`, window.location.origin).toString().replace(/\/$/, "");
  if (!getToken) {
    return new WorkerClient(baseUrl);
  }
  const authHeaders = (): Record<string, string> => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  return new WorkerClient(
    baseUrl,
    async (url, init) => {
      // Before an action, and before nothing else: a poll renewing the token every few seconds
      // would be absurd, while an action fired on a token about to die is a 401 minutes later.
      // The header is read after the renewal, so what goes out is the token that came back.
      if (freshenToken && String(url).includes(ACTION_RUN_PATH)) await freshenToken();
      return fetch(url, { ...init, headers: { ...init?.headers, ...authHeaders() } });
    },
    authHeaders,
  );
};

// The OIDC login round-trip leaves the page but comes straight back with the
// same URL; the git leave-warning must stay silent while the redirect starts.
const AUTH_REDIRECT_NAV_WINDOW_MS = 10_000;

const AuthenticatedApp: React.FC = () => {
  const auth = useAuth();
  const tokenRef = useRef(auth.user?.access_token);
  tokenRef.current = auth.user?.access_token;
  // Auth event handlers outlive any single render; read auth through a ref so
  // they always see the current state instead of a stale closure.
  const authRef = useRef(auth);
  authRef.current = auth;

  // A file action is fired on the token in hand and nothing renews it while the server works, so
  // it is topped up first and the fresh one written straight into the ref the request is about to
  // read: signinSilent resolves before React has re-rendered, and waiting for that render would
  // send the token that was just replaced.
  const freshenToken = useCallback(async () => {
    const renewed = await ensureTokenLife(authRef.current, ACTION_TOKEN_MIN_LIFE_SECONDS);
    if (renewed) tokenRef.current = renewed.access_token;
  }, []);

  const workerClient = useMemo(() => createWorkerClient(() => tokenRef.current, freshenToken), [freshenToken]);

  // Once MainApp has been shown, keep it mounted through token renewals and
  // recovery attempts — unmounting would discard all in-memory editor state.
  const wasAuthenticatedRef = useRef(false);
  if (auth.isAuthenticated) wasAuthenticatedRef.current = true;

  const recoveringRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    markInternalNavigation(AUTH_REDIRECT_NAV_WINDOW_MS);
    authRef.current.signinRedirect({
      state: { returnPath: window.location.pathname + window.location.search + window.location.hash }
    });
  }, []);

  // Renew the session without leaving the page — see recoverSession for the ladder.
  // The interactive redirect is a page load, so it is reached only once every silent
  // route is exhausted, meaning the provider session is gone as well.
  const recoverOrLogin = useCallback(async () => {
    if (recoveringRef.current) return;
    recoveringRef.current = true;
    let outcome: RecoveryOutcome;
    try {
      outcome = await recoverSession(authRef.current);
    } finally {
      recoveringRef.current = false;
    }
    if (outcome === 'login-required') redirectToLogin();
  }, [redirectToLogin]);

  useEffect(() => {
    // A failed background renewal (network blip, IdP restart, refresh-token
    // rotation race) is not worth a full-page redirect: the access token is
    // usually still valid, and the expired handler below retries anyway.
    const removeRenewError = auth.events.addSilentRenewError((error: Error) => {
      console.warn('Silent renewal failed, will retry at token expiry:', error.message);
    });
    const removeExpired = auth.events.addAccessTokenExpired(() => {
      recoverOrLogin();
    });
    return () => {
      removeRenewError();
      removeExpired();
    };
  }, [auth.events, recoverOrLogin]);

  useEffect(() => {
    if (auth.isLoading || auth.activeNavigator || auth.isAuthenticated) return;
    if (wasAuthenticatedRef.current || auth.user) {
      // Session dropped mid-use, or an expired user was restored on load
      // (incl. auth errors) — try silent recovery before any redirect.
      recoverOrLogin();
    } else {
      redirectToLogin();
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.activeNavigator, auth.user, recoverOrLogin, redirectToLogin]);

  if (!wasAuthenticatedRef.current) {
    if (auth.isLoading) return <div>Loading...</div>;
    if (auth.error) return <div>Session expired — redirecting to login...</div>;
    return <div>Redirecting to login...</div>;
  }

  return <MainApp workerClient={workerClient} />;
};

const NoSecurityApp: React.FC = () => {
  const workerClient = useMemo(() => createWorkerClient(), []);

  return <MainApp workerClient={workerClient} />;
};

// --- Entry Point ---

// Which of the two trees this build is: with security, everything hangs under the OIDC provider;
// without it, no provider is mounted at all — and nothing below may assume one is there, which is
// what `cms-core/auth/authToken` exists to guarantee.
const App: React.FC = () => (
  securityEnabled
    ? <AuthProvider {...oidcConfig}><AuthenticatedApp /></AuthProvider>
    : <NoSecurityApp />
);

export default App;
