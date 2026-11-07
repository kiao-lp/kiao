import React, { createContext, useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

/** Plugin routes claim URL prefixes outside the file store and bypass file metadata lookup. */
export interface AppRouteDeclaration {
    /** Router-basename-relative prefix with a leading slash; claims itself and its descendants. */
    prefix: string;
    /** Toolbar panel opened by this route. Its renderer runs beside the open document. */
    panel?: string;
    /** Drawn in place of the document, or beside it when the route targets a panel. */
    render: () => React.ReactNode;
    /** Optional top-banner menu entry; omit for pages reached only by link. */
    menu?: {
        label: string;
        icon?: React.ReactNode;
        /** Opens this toolbar tab instead of navigating; the page remains reachable by URL. */
        showTab?: string;
    };
}

export interface AppRouteMatch {
    route: AppRouteDeclaration;
    /** Unparsed remainder without leading slashes; empty at the prefix itself. */
    rest: string;
}

const AppRoutesContext = createContext<AppRouteDeclaration[]>([]);

export const AppRoutesProvider: React.FC<{ routes: AppRouteDeclaration[]; children: React.ReactNode }> =
    ({ routes, children }) => (
        <AppRoutesContext.Provider value={routes}>{children}</AppRoutesContext.Provider>
    );

export const useAppRoutes = (): AppRouteDeclaration[] => useContext(AppRoutesContext);

/** The longest matching prefix wins, allowing nested plugin routes. */
export const matchAppRoute = (routes: AppRouteDeclaration[], pathname: string): AppRouteMatch | null => {
    let best: AppRouteMatch | null = null;
    for (const route of routes) {
        const prefix = route.prefix.endsWith('/') ? route.prefix.slice(0, -1) : route.prefix;
        if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
        if (best && best.route.prefix.length >= prefix.length) continue;
        best = { route, rest: pathname.slice(prefix.length).replace(/^\/+/, '') };
    }
    return best;
};

/** The current app page, or null for a document URL. */
export const useAppRoute = (): AppRouteMatch | null => {
    const routes = useAppRoutes();
    const { pathname } = useLocation();
    return useMemo(() => matchAppRoute(routes, decodeURIComponent(pathname)), [routes, pathname]);
};
