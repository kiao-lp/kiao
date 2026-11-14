import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToolBars } from '../toolbars/ToolBars-ctx';
import { useAppRoute } from '../../app-routes/AppRoutes-ctx';
import { DOCUMENT_TAB_ID } from '../documents/DocumentContent-ctx';

/** A URL reveals its target tab once; panel routes keep the document mounted. */
export const AppRouteView: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const page = useAppRoute();
    const { key } = useLocation();
    const { tabs, showTab } = useToolBars();
    const panel = page?.route.panel;
    const targetTab = page ? panel : DOCUMENT_TAB_ID;
    const shown = useRef<{ key: string; tabId?: string }>({ key: '' });

    useEffect(() => {
        if (shown.current.key !== key) shown.current = { key };
        if (!targetTab || shown.current.tabId === targetTab) return;
        if (!tabs.some(tab => tab.id === targetTab)) return;
        shown.current.tabId = targetTab;
        showTab(targetTab);
    }, [key, targetTab, tabs, showTab]);

    return <>
        {page && !panel ? page.route.render() : children}
        {panel && page?.route.render()}
    </>;
};
