import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { parentPath } from '../service';
import { useFileBrowsingPersistenceContext } from '../core/FileBrowsingPersistence-ctx';
import { storeLinkOf } from 'kiao-worker/utils';
import { resolveInternalLink } from '../../navigation/internal-links';

export interface NavigationModelApi {
    open: (path: string) => void;
    openInNewTab: (path: string) => void;
    openInNewWindow: (path: string) => void;
    goUp: () => void;
    goTo: (path: string) => void;
}

/** Converts a store path to a browser URL. */
const makeHref = (path: string) =>
    resolveInternalLink(storeLinkOf(path));

export const useNavigation = (): NavigationModelApi => {
    const navigate = useNavigate();
    const { currentPath } = useFileBrowsingPersistenceContext();

    const openInNewTab = useCallback((path: string) => {
        window.open(makeHref(path), '_blank');
    }, []);

    const openInNewWindow = useCallback((path: string) => {
        window.open(makeHref(path), '_blank', 'popup=yes,width=1000,height=800');
    }, []);

    const open = useCallback((path: string) => {
        navigate(path);
    }, [navigate]);

    const goTo = useCallback((path: string) => {
        navigate(path);
    }, [navigate]);

    const goUp = useCallback(() => {
        if (!currentPath) return;
        navigate(parentPath(currentPath));
    }, [navigate, currentPath]);

    return { open, openInNewTab, openInNewWindow, goUp, goTo };
};
