import { useEffect, useRef } from 'react';
import { createSimpleContext } from 'react-concise';
import { useRegisteredHotkeys, BoundHotkey } from './HotkeyRegistry-ctx';

type HotkeyDispatcherProps = {};
type HotkeyDispatcherValue = {};

const defaultValue: HotkeyDispatcherValue = {};

interface ParsedHotkey {
    ctrlOrMeta: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
    key: string;
}

const parseHotkey = (raw: string): ParsedHotkey => {
    const parts = raw.split('+').map(p => p.trim());
    const result: ParsedHotkey = { ctrlOrMeta: false, ctrl: false, meta: false, shift: false, alt: false, key: '' };
    for (const p of parts) {
        const low = p.toLowerCase();
        if (low === 'ctrl' || low === 'control') result.ctrl = true;
        else if (low === 'cmd' || low === 'meta' || low === 'command') result.meta = true;
        else if (low === 'mod') result.ctrlOrMeta = true;
        else if (low === 'shift') result.shift = true;
        else if (low === 'alt' || low === 'option') result.alt = true;
        else result.key = p;
    }
    return result;
};

const keyMatches = (parsed: ParsedHotkey, event: KeyboardEvent): boolean => {
    if (parsed.key.length === 1) {
        if (event.key.toLowerCase() !== parsed.key.toLowerCase()) return false;
    } else {
        if (event.key !== parsed.key) return false;
    }

    if (parsed.ctrlOrMeta) {
        if (!(event.ctrlKey || event.metaKey)) return false;
    } else {
        if (parsed.ctrl !== event.ctrlKey) return false;
        if (parsed.meta !== event.metaKey) return false;
    }
    if (parsed.shift !== event.shiftKey) return false;
    if (parsed.alt !== event.altKey) return false;
    return true;
};

const useHotkeyDispatcherValue = (_props: HotkeyDispatcherProps): HotkeyDispatcherValue => {
    const hotkeys = useRegisteredHotkeys();

    // Read through a ref by a listener attached once, rather than re-attached on every change:
    // the ref is fresh as of the last render, while a re-attach waits for an effect — and a key
    // pressed in between (Ctrl+V straight after the click that entered EDIT mode) meets the
    // previous listener's snapshot, in which the hotkey is still disabled. Registration itself
    // lands pre-paint (see usePluginHotkeys), so from the first painted frame on, what the
    // listener reads is what the screen shows.
    const hotkeysRef = useRef(hotkeys);
    hotkeysRef.current = hotkeys;

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const activeElement = document.activeElement as HTMLElement;
            if (
                activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.tagName === 'SELECT' ||
                activeElement.isContentEditable ||
                activeElement.closest('.ant-modal-wrap')
            ) {
                return;
            }

            const match = findMatch(hotkeysRef.current, event);
            if (!match) return;

            event.preventDefault();
            event.stopPropagation();
            match.execute();
        };
        document.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, []);

    return {};
};

const findMatch = (hotkeys: BoundHotkey[], event: KeyboardEvent): BoundHotkey | undefined => {
    for (const h of hotkeys) {
        const parsed = parseHotkey(h.key);
        if (keyMatches(parsed, event)) return h;
    }
    return undefined;
};

const hookBasedContext = createSimpleContext(useHotkeyDispatcherValue, defaultValue);

export const HotkeyDispatcherProvider = hookBasedContext.Provider;
export const useHotkeyDispatcherContext = hookBasedContext.useContext;
