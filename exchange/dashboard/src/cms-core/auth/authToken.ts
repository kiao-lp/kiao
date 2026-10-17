/**
 * No-security builds mount no AuthProvider. Read AuthContext directly because useAuth()
 * warns on every render without a provider; its absence is legitimate here.
 */
import { useContext } from 'react';
import { AuthContext } from 'react-oidc-context';

/** Build-time authentication switch. */
export const securityEnabled = import.meta.env.VITE_NO_SECURITY !== 'true';

/**
 * Undefined without security or an authenticated session, including during renewal.
 * Callers must then omit the Authorization header.
 */
export const useAuthToken = (): string | undefined => {
    const auth = useContext(AuthContext);
    return securityEnabled ? auth?.user?.access_token : undefined;
};
