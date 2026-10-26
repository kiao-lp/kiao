import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSimpleContext } from 'react-concise';
import { DocumentCodec, useDocumentFileSync, useFileViewState } from '@cms-core';
import { createEditorModeContext } from './lib/EditorMode-ctx';
import { decodeMindmap, encodeMindmap, MindmapDocument, MindmapIdentity } from './mindmapDocument';
import {
    Mindmap, MindmapElement, ElementMap,
    NewNoteStyle, DEFAULT_NEW_NOTE_STYLE, NewRelationStyle, DEFAULT_NEW_RELATION_STYLE
} from './model';

// === Types ===

type Point2D = number[];

export type MindmapMode = 'EDIT' | 'EDIT_DRAG' | 'EDIT_MODIFY_ELEMENT' | 'VISUALIZE';

export type SelectElementsFn = (selectFn: (e: MindmapElement) => boolean) => MindmapElement[];
export type FilterElementsFn = (filterFn: (e: MindmapElement) => boolean) => void;
export type MapElementsFn = (mapFn: (e: MindmapElement) => MindmapElement) => void;
export type AddElementFn = <T extends MindmapElement>(category: string, element: T) => void;
export type AddElementsFn = (map: ElementMap) => void;
export type PatchElementFn = <T extends MindmapElement>(category: string, id: string, patch: Partial<T>) => void;

export interface MindmapStateValue {
    // Persistence
    mindmap: Mindmap | null;
    setMindmap: React.Dispatch<React.SetStateAction<Mindmap | null>>;
    saveMindmap: () => void;

    // Element operations
    selectElements: SelectElementsFn;
    filterElements: FilterElementsFn;
    mapElements: MapElementsFn;
    addElement: AddElementFn;
    addElements: AddElementsFn;
    patchElement: PatchElementFn;

    // UI State
    pointedLocation: Point2D;
    setPointedLocation: (loc: Point2D) => void;
    zoom: number;
    setZoom: (zoom: number) => void;
    newNoteStyle: NewNoteStyle;
    patchNewNoteStyle: (patch: Partial<NewNoteStyle>) => void;
    newRelationStyle: NewRelationStyle;
    patchNewRelationStyle: (patch: Partial<NewRelationStyle>) => void;
}

// === Internal Persistence Hook ===

/**
 * The map on screen, and the file under it.
 *
 * **The document is followed rather than owned**: the file is watched while it is open, so a
 * change made to it elsewhere — worker repairing a link after a rename, a Claude turn, a
 * `git pull` — is read back into the open map instead of being discovered on the next open. A map
 * left open used to be a stale copy that the next note moved wrote back over the repair.
 *
 * The editing state stays local to this editor rather than being the hook's document, because a
 * map is mutated far more often than it is saved: a drag moves it on every mouse event and writes
 * once, at the end. So `setMindmap` moves what is drawn and `saveMindmap` is what the file hears —
 * the split every caller already works in. What arrives from the file is adopted here, and told
 * apart from our own writes coming back by the document's identity: `onDocChange` hands the hook
 * the very object we built, so only a document we have not seen before came from the disk.
 */
const useMindmapPersistence = (path: string) => {
    // A map written by hand, or pasted in as the bare elements it is, carries no identity. It is
    // given one here — once for the file, so that a save keeps it rather than minting a new
    // document over the old one on every write.
    const minted = useRef<{ path: string } & MindmapIdentity | null>(null);
    const identityFor = useCallback((target: string): MindmapIdentity => {
        if (minted.current?.path !== target) {
            minted.current = { path: target, docId: crypto.randomUUID(), createdAt: new Date().toISOString() };
        }
        return minted.current;
    }, []);

    const codec = useMemo<DocumentCodec<MindmapDocument>>(() => ({
        parse: decodeMindmap,
        serialize: document => encodeMindmap(document, identityFor(path)),
    }), [path, identityFor]);

    const { doc, text: screenText, onDocChange } = useDocumentFileSync(path || undefined, codec);

    const [mindmap, setMindmapState] = useState<Mindmap | null>(null);
    // What is drawn and what the file last showed, as refs: a save is called in the same handler
    // as the change it saves, so it cannot wait for the render to read either of them.
    const edited = useRef<Mindmap | null>(null);
    const seen = useRef<MindmapDocument | null>(null);
    // The text on screen, likewise: a save compares against it without re-rendering for it.
    const screenRef = useRef(screenText);
    screenRef.current = screenText;

    const adopt = useCallback((map: Mindmap | null) => {
        edited.current = map;
        setMindmapState(map);
    }, []);

    // A document this editor has not put there itself: the file was read, or read again. What we
    // wrote comes back as the object we handed over, and lands here as a no-op.
    useEffect(() => {
        if (doc === seen.current) return;
        seen.current = doc;
        adopt(doc?.mindmap ?? null);
    }, [doc, adopt]);

    const setMindmap = useCallback<React.Dispatch<React.SetStateAction<Mindmap | null>>>(update => {
        adopt(typeof update === 'function' ? update(edited.current) : update);
    }, [adopt]);

    const saveMindmap = useCallback(() => {
        const map = edited.current;
        if (!map) return;
        const next = { envelope: seen.current?.envelope ?? {}, mindmap: map };
        // A save for a map the file already holds — a measure landing back where it was —
        // writes nothing: serializing is stable, so equal texts mean an unchanged map.
        if (codec.serialize(next) === screenRef.current) return;
        const stamped = {
            envelope: { ...next.envelope, updatedAt: new Date().toISOString() },
            mindmap: map,
        };
        seen.current = stamped;
        onDocChange(stamped);
    }, [onDocChange, codec]);

    return useMemo(() => ({ mindmap, setMindmap, saveMindmap }), [mindmap, setMindmap, saveMindmap]);
};

// === State Context Implementation ===

interface MindmapStateProps {
    /** The store path of the `.mmap.json` the state is that of. */
    mindmapId: string;
    initialPointedLocation?: Point2D;
}

function useContextValueObject<T>(object: { [s: string]: T }): unknown {
    // eslint-disable-next-line
    return useMemo(() => object, Object.values(object));
}

const useMindmapState = (props: MindmapStateProps): MindmapStateValue => {
    const { mindmap, setMindmap, saveMindmap } = useMindmapPersistence(props.mindmapId);
    const [pointedLocation, setPointedLocationInternal] = React.useState<Point2D>(props.initialPointedLocation || []);
    // Per map rather than app-wide: a dense map and a small one want different
    // zoom levels, and each is reopened at the one it was left at. The style new notes and new
    // relations are made with is remembered the same way, a map being drawn in one style at a time.
    const [view, setView] = useFileViewState('mindmap', {
        zoom: 1.0,
        newNoteFontSize: DEFAULT_NEW_NOTE_STYLE.fontSize,
        newNoteShape: DEFAULT_NEW_NOTE_STYLE.shape,
        newNoteEdge: DEFAULT_NEW_NOTE_STYLE.edge,
        newNoteBorderColor: DEFAULT_NEW_NOTE_STYLE.borderColor,
        newNoteBackground: DEFAULT_NEW_NOTE_STYLE.background,
        newRelationBody: DEFAULT_NEW_RELATION_STYLE.body,
        newRelationWidth: DEFAULT_NEW_RELATION_STYLE.width,
        newRelationColor: DEFAULT_NEW_RELATION_STYLE.color
    });
    const zoom = view.zoom;

    const setPointedLocation = useCallback((loc: Point2D) => {
        setPointedLocationInternal(loc);
    }, []);

    const setZoom = useCallback((newZoom: number) => {
        // Clamp zoom between 0.25 (25%) and 2.0 (200%)
        setView({ zoom: Math.max(0.25, Math.min(2.0, newZoom)) });
    }, [setView]);

    const newNoteStyle = useMemo<NewNoteStyle>(() => ({
        fontSize: view.newNoteFontSize,
        shape: view.newNoteShape,
        edge: view.newNoteEdge,
        borderColor: view.newNoteBorderColor,
        background: view.newNoteBackground
    }), [view.newNoteFontSize, view.newNoteShape, view.newNoteEdge, view.newNoteBorderColor,
        view.newNoteBackground]);

    const patchNewNoteStyle = useCallback((patch: Partial<NewNoteStyle>) => {
        setView(previous => ({
            newNoteFontSize: patch.fontSize ?? previous.newNoteFontSize,
            newNoteShape: patch.shape ?? previous.newNoteShape,
            newNoteEdge: patch.edge ?? previous.newNoteEdge,
            newNoteBorderColor: patch.borderColor ?? previous.newNoteBorderColor,
            newNoteBackground: patch.background ?? previous.newNoteBackground
        }));
    }, [setView]);

    const newRelationStyle = useMemo<NewRelationStyle>(() => ({
        body: view.newRelationBody,
        width: view.newRelationWidth,
        color: view.newRelationColor
    }), [view.newRelationBody, view.newRelationWidth, view.newRelationColor]);

    const patchNewRelationStyle = useCallback((patch: Partial<NewRelationStyle>) => {
        setView(previous => ({
            newRelationBody: patch.body ?? previous.newRelationBody,
            newRelationWidth: patch.width ?? previous.newRelationWidth,
            newRelationColor: patch.color ?? previous.newRelationColor
        }));
    }, [setView]);

    const selectElements: SelectElementsFn = useCallback((selectFn) => {
        if (!mindmap) return [];
        return Object.entries(mindmap.elements)
            .flatMap((entry) => entry[1].filter(selectFn));
    }, [mindmap]);

    const mapElements: MapElementsFn = useCallback((mapFn): void => {
        setMindmap(mindmap => mindmap ? {
            ...mindmap,
            elements: Object.entries(mindmap.elements)
                .map((entry) => [entry[0], entry[1].map(mapFn)] as [string, MindmapElement[]])
                .reduce((map, [key, value]) => ({ ...map, [key]: value }), {})
        } : null);
    }, [setMindmap]);

    const filterElements: FilterElementsFn = useCallback((filterFn): void => {
        setMindmap(mindmap => mindmap ? {
            ...mindmap,
            elements: Object.entries(mindmap.elements)
                .map((entry) => [entry[0], entry[1].filter(filterFn)] as [string, MindmapElement[]])
                .reduce((map, [key, value]) => ({ ...map, [key]: value }), {})
        } : null);
    }, [setMindmap]);

    const addElements: AddElementsFn = useCallback((elementMap): void => {
        setMindmap(mindmap => mindmap ? {
            ...mindmap,
            elements: Object.entries(elementMap).reduce<ElementMap>(
                (prev, [key, elements]) => ({
                    ...prev,
                    [key]: [...(prev[key] ?? []), ...elements]
                }),
                mindmap.elements
            )
        } : null);
    }, [setMindmap]);

    const addElement: AddElementFn = useCallback((category, element): void => {
        setMindmap(mindmap => mindmap ? {
            ...mindmap,
            elements: {
                ...mindmap.elements,
                [category]: mindmap.elements[category] ? [...mindmap.elements[category], element] : [element]
            }
        } : null);
    }, [setMindmap]);

    const patchElement: PatchElementFn = useCallback((category, id, patch): void => {
        setMindmap(mindmap => mindmap ? {
            ...mindmap,
            elements: {
                ...mindmap.elements,
                [category]: mindmap.elements[category].map((element) => (element.id === id ? { ...element, ...patch } : element))
            }
        } : null);
    }, [setMindmap]);

    return useContextValueObject({
        mindmap, setMindmap, saveMindmap,
        selectElements, filterElements, mapElements, addElement, addElements, patchElement,
        pointedLocation, setPointedLocation,
        zoom, setZoom,
        newNoteStyle, patchNewNoteStyle,
        newRelationStyle, patchNewRelationStyle
    }) as MindmapStateValue;
};

const defaultValue: MindmapStateValue = {
    mindmap: null,
    setMindmap: () => { },
    saveMindmap: () => { },
    selectElements: () => [],
    filterElements: () => { },
    mapElements: () => { },
    addElement: () => { },
    addElements: () => { },
    patchElement: () => { },
    pointedLocation: [],
    setPointedLocation: () => { },
    zoom: 1.0,
    setZoom: () => { },
    newNoteStyle: DEFAULT_NEW_NOTE_STYLE,
    patchNewNoteStyle: () => { },
    newRelationStyle: DEFAULT_NEW_RELATION_STYLE,
    patchNewRelationStyle: () => { }
};

const stateContext = createSimpleContext(useMindmapState, defaultValue);

// === Editor Mode Context (separate for clean typing) ===

export const {
    Provider: MindmapModeProvider,
    useEditorMode: useMindmapMode
} = createEditorModeContext<MindmapMode>('VISUALIZE');

// === Exports ===

export const useMindmapStateContext = stateContext.useContext;

// Compound provider that wraps both persistence and state
export interface MindmapStateProviderProps {
    mindmapId: string;
    children?: React.ReactNode;
}

export const MindmapStateProvider: React.FC<MindmapStateProviderProps> = ({ mindmapId, children }) => (
    <MindmapModeProvider>
        <stateContext.Provider mindmapId={mindmapId}>
            {children}
        </stateContext.Provider>
    </MindmapModeProvider>
);
