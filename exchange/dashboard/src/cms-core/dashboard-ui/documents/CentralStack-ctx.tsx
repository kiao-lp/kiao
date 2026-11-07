import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from '../../ui-foundation/feedback/Tooltip';
import { DOCUMENT_TAB_ID } from './DocumentContent-ctx';
import './Documents.css';

export interface CentralPanel {
    /** Re-push replaces and moves to top. */
    id: string;
    /** Toolbar tab that displays this panel. The document tab when omitted. */
    host?: string;
    /** Header line; omitted means no header. */
    title?: string;
    /** Accessible name; defaults to title. */
    label?: string;
    /** `Cancel` when abandoning work, else `Close`. */
    closeLabel?: string;
    /** Panel content, read live from context. */
    content: React.ReactNode;
    /** Fires on removal via cross or `close`; no-op if absent. */
    onClose?: () => void;
}

interface CentralStackValue {
    /** Panels on the stack, bottom first. Excludes the document. */
    panels: CentralPanel[];
    /** Pushes a panel over the current view. Same id pushes once. */
    push: (panel: CentralPanel) => void;
    /** Removes a panel wherever it sits, firing its `onClose`. */
    close: (id: string) => void;
}

const CentralStackContext = createContext<CentralStackValue | null>(null);

export const useCentralStack = (): CentralStackValue => {
    const context = useContext(CentralStackContext);
    if (!context) throw new Error('useCentralStack must be used within a CentralStackProvider');
    return context;
};

/** Panels stack over their host tab without masking chrome; confirmations stay modals. */
export const CentralStackProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const [panels, setPanels] = useState<CentralPanel[]>([]);
    // Mirror keeps the state updater pure under StrictMode.
    const latest = useRef(panels);
    latest.current = panels;

    const push = useCallback((panel: CentralPanel) => {
        setPanels(prev => [...prev.filter(one => one.id !== panel.id), panel]);
    }, []);

    const close = useCallback((id: string) => {
        const leaving = latest.current.find(one => one.id === id);
        if (!leaving) return;
        latest.current = latest.current.filter(one => one.id !== id);
        setPanels(latest.current);
        leaving.onClose?.();
    }, []);

    const value = useMemo(
        () => ({ panels, push, close }),
        [panels, push, close],
    );

    return <CentralStackContext.Provider value={value}>{children}</CentralStackContext.Provider>;
};

/** All panels stay mounted; buried panels are `hidden` to block focus and paint. */
export const CentralStackView: React.FC<{ host?: string }> = ({ host }) => {
    const stack = useContext(CentralStackContext);
    if (!stack) return null;
    const { panels, close } = stack;
    const shown = host === undefined
        ? panels
        : panels.filter(panel => (panel.host ?? DOCUMENT_TAB_ID) === host);
    if (shown.length === 0) return null;
    const top = shown[shown.length - 1].id;

    return (
        <div className="cms-stack" data-testid="central-stack">
            {shown.map(panel => {
                const buried = panel.id !== top;
                const dismiss = panel.closeLabel ?? 'Close';
                return (
                    <section
                        key={panel.id}
                        role="dialog"
                        aria-label={panel.label ?? panel.title ?? panel.id}
                        aria-hidden={buried || undefined}
                        data-testid={`central-panel-${panel.id}`}
                        className="cms-stack-panel"
                        hidden={buried || undefined}
                    >
                        {panel.title !== undefined && (
                            <div className="cms-stack-header">{panel.title}</div>
                        )}
                        <Tooltip title={dismiss}>
                            <Button
                                className="cms-stack-close"
                                type="text"
                                icon={<CloseOutlined />}
                                onClick={() => close(panel.id)}
                                aria-label={dismiss}
                                data-testid={`central-panel-${panel.id}-close`}
                            />
                        </Tooltip>
                        <div className="cms-stack-body">{panel.content}</div>
                    </section>
                );
            })}
        </div>
    );
};
