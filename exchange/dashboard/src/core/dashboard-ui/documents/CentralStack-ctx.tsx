import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
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
    /** Controls on the right of the host tab strip while this panel is on top. */
    additionalPanels?: React.ReactNode;
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

interface CentralStackState extends CentralStackValue {
    controls: ReadonlyMap<string, React.ReactNode>;
    setControls: (id: string, controls: React.ReactNode) => void;
}

const CentralStackContext = createContext<CentralStackState | null>(null);
const CentralPanelContext = createContext<string | null>(null);

export const useCentralStackControls = (host: string | null | undefined, fallback?: React.ReactNode): React.ReactNode => {
    const stack = useContext(CentralStackContext);
    const top = host === null ? undefined : stack?.panels.filter(panel =>
        host === undefined || (panel.host ?? DOCUMENT_TAB_ID) === host).at(-1);
    return top ? stack?.controls.get(top.id) ?? top.additionalPanels : fallback;
};

/** Portals retain the panel's providers and local state in the tab strip. */
export const CentralPanelControls: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const id = useContext(CentralPanelContext);
    const setControls = useContext(CentralStackContext)?.setControls;
    const [target, setTarget] = useState<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        if (!id || !setControls) return;
        setControls(id, <div style={{ display: 'contents' }} ref={setTarget} />);
        return () => setControls(id, undefined);
    }, [id, setControls]);

    return target ? createPortal(children, target) : null;
};

export const useCentralStack = (): CentralStackValue => {
    const context = useContext(CentralStackContext);
    if (!context) throw new Error('useCentralStack must be used within a CentralStackProvider');
    return context;
};

/** Panels stack over their host tab without masking chrome; confirmations stay modals. */
export const CentralStackProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const [panels, setPanels] = useState<CentralPanel[]>([]);
    const [controls, setPanelControls] = useState<ReadonlyMap<string, React.ReactNode>>(() => new Map());
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

    const setControls = useCallback((id: string, controls: React.ReactNode) => {
        setPanelControls(prev => {
            if (prev.get(id) === controls) return prev;
            const next = new Map(prev);
            if (controls === undefined) next.delete(id);
            else next.set(id, controls);
            return next;
        });
    }, []);

    const value = useMemo(
        () => ({ panels, push, close, controls, setControls }),
        [panels, push, close, controls, setControls],
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
                        <Button
                            className="cms-stack-close"
                            type="text"
                            icon={<CloseOutlined />}
                            onClick={() => close(panel.id)}
                            aria-label={dismiss}
                            data-testid={`central-panel-${panel.id}-close`}
                        />
                        <CentralPanelContext.Provider value={panel.id}>
                            <div className="cms-stack-body">{panel.content}</div>
                        </CentralPanelContext.Provider>
                    </section>
                );
            })}
        </div>
    );
};
