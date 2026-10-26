import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { Tooltip } from '../ui/Tooltip';

/**
 * A panel pushed onto the central area's stack.
 */
export interface CentralPanel {
    /**
     * Stable identity. Pushing a panel whose id is already on the stack replaces it and moves
     * it to the top, so opening twice is opening once — the button that pushed it is still on
     * screen, the stack never blocking the chrome around it.
     */
    id: string;
    /**
     * The header line. Left out, there is no header at all: the content carries its own, like
     * the flow node editor's title box.
     */
    title?: string;
    /** The accessible name, where the title is none or says it badly. The title, left out. */
    label?: string;
    /**
     * What the floating cross says: `Cancel` where there is something to abandon, `Close`
     * everywhere else.
     */
    closeLabel?: string;
    /** What the panel shows. Read live, so it may fill itself from a context. */
    content: React.ReactNode;
    /**
     * Fired when the panel leaves the stack — through the cross or through `close` — and only
     * then: closing what is not there calls nothing. Where the opener holds the state the panel
     * shows (the board holding whether its flow node editor is open), this is what writes it back.
     */
    onClose?: () => void;
}

interface CentralStackValue {
    /** The panels now on the stack, bottom first. The document itself is not one of them. */
    panels: CentralPanel[];
    /** Pushes a panel over whatever the central area is showing. Same id pushes once. */
    push: (panel: CentralPanel) => void;
    /** Takes a panel off the stack wherever it sits, firing its `onClose`. */
    close: (id: string) => void;
}

const CentralStackContext = createContext<CentralStackValue | null>(null);

export const useCentralStack = (): CentralStackValue => {
    const context = useContext(CentralStackContext);
    if (!context) throw new Error('useCentralStack must be used within a CentralStackProvider');
    return context;
};

/**
 * The central area as a stack: panels pushed over the document, each closing back onto the one
 * below it.
 *
 * It is for the panels that have to be **filled in to continue** — a form whose answers become
 * the next thing, like the flow node template being instantiated — and not for the confirmations,
 * which stay modals: deleting a file wants a yes or a no, not a place to work in.
 *
 * A pushed panel **covers the document and nothing else**, and it never blocks the chrome around
 * it: there is no mask and no focus trap, so the file tree stays usable while it is open and a
 * file dragged out of it still lands where it is dropped. That is the whole difference with a
 * dialog, and the reason this exists.
 *
 * One stack per central area, provided by `LayoutContent` above both the document and the tool
 * bars — the bars push too, a panel opening its editor over the middle of the screen. Leaving the
 * document empties it: the panels belong to what was showing, not to the application.
 */
export const CentralStackProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const [panels, setPanels] = useState<CentralPanel[]>([]);
    // What `close` answers `onClose` from. The state setter's updater must stay pure — StrictMode
    // runs it twice — so the leaving panel is read off a mirror rather than found inside one.
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

/**
 * The stack itself, drawn inside the central area over the document. Every panel stays mounted
 * under the top one, so closing is going back — the state it held is the state it is found in —
 * and the ones below carry `hidden` rather than unmounting: what cannot be seen cannot take the
 * focus either, and nothing of a buried panel — its dropdowns included — paints over the top one.
 *
 * Each panel carries the same floating cross as a closing file, top-right over whatever it shows.
 * What the content holds besides is its own: the Instantiate button of a template, say, which is
 * the panel's answer rather than its dismissal.
 */
export const CentralStackView: React.FC = () => {
    const { panels, close } = useCentralStack();
    if (panels.length === 0) return null;
    const top = panels[panels.length - 1].id;

    return (
        <div className="cms-stack" data-testid="central-stack">
            {panels.map(panel => {
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
