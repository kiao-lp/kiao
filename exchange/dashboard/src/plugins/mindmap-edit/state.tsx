import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSimpleContext } from 'react-concise';
import { DocumentCodec, useDocumentFileSync, useFileViewState } from '@cms-core';
import { createEditorModeContext } from './lib/EditorMode-ctx';
import { decodeMindmap, encodeMindmap, MindmapDocument, MindmapIdentity } from './mindmapDocument';
import {
    Mindmap, MindmapElement, ElementMap,
    NewNoteStyle, DEFAULT_NEW_NOTE_STYLE, NewRelationStyle, DEFAULT_NEW_RELATION_STYLE
} from './model';


type Point2D = number[];

export type MindmapMode = 'EDIT' | 'EDIT_DRAG' | 'EDIT_MODIFY_ELEMENT' | 'VISUALIZE';

export type SelectElementsFn = (selectFn: (e: MindmapElement) => boolean) => MindmapElement[];
export type FilterElementsFn = (filterFn: (e: MindmapElement) => boolean) => void;
export type MapElementsFn = (mapFn: (e: MindmapElement) => MindmapElement) => void;
export type AddElementFn = <T extends MindmapElement>(category: string, element: T) => void;
export type AddElementsFn = (map: ElementMap) => void;
export type PatchElementFn = <T extends MindmapElement>(category: string, id: string, patch: Partial<T>) => void;

export interface MindmapStateValue {
    mindmap: Mindmap | null;
    setMindmap: React.Dispatch<React.SetStateAction<Mindmap | null>>;
    saveMindmap: () => void;

    selectElements: SelectElementsFn;
    filterElements: FilterElementsFn;
    mapElements: MapElementsFn;
    addElement: AddElementFn;
    addElements: AddElementsFn;
    patchElement: PatchElementFn;

    pointedLocation: Point2D;
    setPointedLocation: (loc: Point2D) => void;
    zoom: number;
    setZoom: (zoom: number) => void;
    newNoteStyle: NewNoteStyle;
    patchNewNoteStyle: (patch: Partial<NewNoteStyle>) => void;
    newRelationStyle: NewRelationStyle;
    patchNewRelationStyle: (patch: Partial<NewRelationStyle>) => void;
}


/** The map on screen, and the file under it. **The document is followed rather than owned**: the file. */
const useMindmapPersistence = (path: string) => {
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


interface MindmapStateProps {
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


export const {
    Provider: MindmapModeProvider,
    useEditorMode: useMindmapMode
} = createEditorModeContext<MindmapMode>('VISUALIZE');


export const useMindmapStateContext = stateContext.useContext;

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
