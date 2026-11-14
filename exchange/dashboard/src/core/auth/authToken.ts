/** Reads AuthContext directly; useAuth() warns without a provider. */
import { useContext } from 'react';
import { AuthContext } from 'react-oidc-context';

/** Build-time authentication switch. */
export const securityEnabled = import.meta.env.VITE_NO_SECURITY !== 'true';

/** Undefined without security or a session; callers omit the Authorization header. */
export const useAuthToken = (): string | undefined => {
    const auth = useContext(AuthContext);
    return securityEnabled ? auth?.user?.access_token : undefined;
};
