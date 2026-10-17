/**
 * The answers to every template of the application: one heap, and one map of which optional
 * sections are in.
 *
 * **One store, application wide.** A variable is a thing about the person and the work rather than
 * about the file being written — a name, a folder, a ticket — so an answer given to instantiate one
 * template is the answer the next one opens with, whether it is a `.temp.md` being edited in
 * `template-edit` or a flow node's description being written from one in `hybridflow-ui`. It survives a
 * reload, being kept in the tab's session storage, and it is gone with the tab: values are a
 * convenience, not a document.
 *
 * It is a store of its own rather than a context because nothing contains both of its readers: a
 * plugin's panel and another plugin's dialog are mounted in different parts of the tree.
 */
import { useState, useEffect } from 'react';
import { KiaoElHeap } from '@cms-kit/template-lang';

type Listener = () => void;

class GlobalTemplateStore {
    private heap: KiaoElHeap = {};
    private enabledMap: Record<string, boolean> = {};
    private listeners: Set<Listener> = new Set();

    getSnapshot = () => {
        return {
            heap: this.heap,
            enabledMap: this.enabledMap,
        };
    }

    subscribe = (listener: Listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify() {
        this.listeners.forEach(l => l());
    }

    private loadFromStorage() {
        try {
            const stored = sessionStorage.getItem('dashboard_template_store');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed.heap) this.heap = parsed.heap;
                if (parsed.enabledMap) this.enabledMap = parsed.enabledMap;
            }
        } catch (e) {
            console.warn('Failed to load template store from session storage', e);
        }
    }

    private saveToStorage() {
        try {
            sessionStorage.setItem('dashboard_template_store', JSON.stringify({
                heap: this.heap,
                enabledMap: this.enabledMap
            }));
        } catch (e) {
            console.warn('Failed to save template store to session storage', e);
        }
    }

    constructor() {
        this.loadFromStorage();
    }

    setHeap(heap: KiaoElHeap | ((prev: KiaoElHeap) => KiaoElHeap)) {
        if (typeof heap === 'function') {
            this.heap = heap(this.heap);
        } else {
            this.heap = heap;
        }
        this.saveToStorage();
        this.notify();
    }

    setEnabledMap(map: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) {
        if (typeof map === 'function') {
            this.enabledMap = map(this.enabledMap);
        } else {
            this.enabledMap = map;
        }
        this.saveToStorage();
        this.notify();
    }
}

export const globalTemplateStore = new GlobalTemplateStore();

export const useGlobalTemplateStore = () => {
    const [state, setState] = useState(globalTemplateStore.getSnapshot());

    useEffect(() => {
        return globalTemplateStore.subscribe(() => {
            setState(globalTemplateStore.getSnapshot());
        });
    }, []);

    return {
        ...state,
        setHeap: globalTemplateStore.setHeap.bind(globalTemplateStore),
        setEnabledMap: globalTemplateStore.setEnabledMap.bind(globalTemplateStore),
    };
};
