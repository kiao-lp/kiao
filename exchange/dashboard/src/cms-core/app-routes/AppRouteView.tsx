import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToolBars } from '../tool-bars/ToolBars-ctx';
import { useAppRoute } from './AppRoutes-ctx';

/** Panel routes keep the document mounted and reveal their tab once per navigation. */
export const AppRouteView: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const page = useAppRoute();
    const { key } = useLocation();
    const bars = useToolBars();
    const shown = useRef<string | null>(null);
    const panel = page?.route.panel;

    useEffect(() => {
        if (!panel) {
            shown.current = null;
            return;
        }
        if (shown.current === key || !bars.tabs.some(tab => tab.id === panel)) return;
        shown.current = key;
        bars.showTab(panel);
    }, [bars, key, panel]);

    return <>
        {page && !panel ? page.route.render() : children}
        {panel && page?.route.render()}
    </>;
};
