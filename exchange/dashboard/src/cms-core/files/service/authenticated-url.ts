import { useAuthToken } from '../../auth/authToken';

/**
 * The URL an `<img>` or an `<a>` can fetch a file through — those carry no headers of their
 * own, so a secured build passes the token as a query parameter instead. Without security
 * (see `useAuthToken`) the bare URL is already fetchable.
 */
export const useAuthenticatedFileUrl = (path: string): string => {
    const token = useAuthToken();
    const cleanUrl = `/api/files/getFile?path=${encodeURIComponent(path)}`;
    return token ? `${cleanUrl}&access_token=${token}` : cleanUrl;
};
