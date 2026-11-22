import { useAuthToken } from '../../auth/authToken';

/** File URL for `<img>`/`<a>`, which send no headers. Adds the auth token as a query parameter when present. */
export const useAuthenticatedFileUrl = (path: string): string => {
    const token = useAuthToken();
    const cleanUrl = `/api/files/getFile?path=${encodeURIComponent(path)}`;
    return token ? `${cleanUrl}&access_token=${token}` : cleanUrl;
};
