import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { AuthProvider, useAuth } from 'react-oidc-context';
import { securityEnabled } from './core/auth/authToken';
import {
  ACTION_TOKEN_MIN_LIFE_SECONDS,
  ensureTokenLife,
  recoverSession,
  type RecoveryOutcome,
} from './core/auth/sessionRecovery';
import { DashboardApp } from './core/dashboard-ui/app/DashboardApp';
import { createWorkerClient } from './core/files/service/workerClient';
import { markInternalNavigation } from './core/navigation/internal-navigation';

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, '');

const oidcConfig = {
  authority: import.meta.env.VITE_OIDC_AUTHORITY || "http://localhost:8080/realms/kiao",
  client_id: "dashboard",
  redirect_uri: window.location.origin + BASE_PATH,
  // A bare page whose only job is to hand the response back — see public/silent-renew.
  silent_redirect_uri: window.location.origin + BASE_PATH + '/silent-renew.html',
  automaticSilentRenew: true,
  onSigninCallback: (_user: any) => {
    const returnPath = _user?.state?.returnPath;
    const targetPath = returnPath || BASE_PATH;
    window.history.replaceState({}, document.title, targetPath);
  }
};

// The OIDC login round-trip leaves the page but comes straight back with the same URL; the git leave-warning must stay silent.
const AUTH_REDIRECT_NAV_WINDOW_MS = 10_000;

const AuthenticatedApp: React.FC = () => {
  const auth = useAuth();
  const tokenRef = useRef(auth.user?.access_token);
  tokenRef.current = auth.user?.access_token;
  const authRef = useRef(auth);
  authRef.current = auth;

  const freshenToken = useCallback(async () => {
    const renewed = await ensureTokenLife(authRef.current, ACTION_TOKEN_MIN_LIFE_SECONDS);
    if (renewed) tokenRef.current = renewed.access_token;
  }, []);

  const workerClient = useMemo(() => createWorkerClient(() => tokenRef.current, freshenToken), [freshenToken]);

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
    // A failed background renewal (network blip, IdP restart, refresh-token rotation race) is not worth a full-page redirect:.
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

  return <DashboardApp workerClient={workerClient} />;
};

const NoSecurityApp: React.FC = () => {
  const workerClient = useMemo(() => createWorkerClient(), []);

  return <DashboardApp workerClient={workerClient} />;
};

// Which of the two trees this build is: with security, everything hangs under the OIDC provider; without it, no provider is mounted.
const App: React.FC = () => (
  securityEnabled
    ? <AuthProvider {...oidcConfig}><AuthenticatedApp /></AuthProvider>
    : <NoSecurityApp />
);

export default App;
