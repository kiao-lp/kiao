import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArchDiaFile,
    ArchDiaLayout,
    DiagramScene,
    RelationBend,
    parseArchDiaFile,
    serializeArchDiaFile,
    getCombinedSource,
    ensureAllPositions,
    importAsArchDia,
    plantumlExtractor,
    resetLayout as computeResetLayout,
    applyPlantUmlLayout as computePlantUml,
    applyTreemapLayout as computeTreemap,
} from '@cms-kit/archdia';

const EMPTY_SCENE: DiagramScene = { components: [], containers: [], relations: [] };

/** Extract a DiagramScene from a combined PlantUML source string. */
const extractScene = (combinedSource: string): DiagramScene => ({
    components: plantumlExtractor.extractComponents(combinedSource),
    containers: plantumlExtractor.extractContainers(combinedSource),
    relations: plantumlExtractor.extractRelations(combinedSource),
});

export interface ArchDiaDraft {
    archDiaFile: ArchDiaFile | null;
    /** Diagram structure inferred from PlantUML — never persisted. */
    scene: DiagramScene;
    /** The text to write back: the model re-serialized, or the raw editor's own text. */
    content: string;
    loading: boolean;
    error: string | null;
    updateSource: (newSource: string) => Promise<void>;
    updateLayout: (newLayout: ArchDiaLayout) => void;
    updatePositions: (updates: Record<string, { x: number; y: number }>) => void;
    /** Move relation centres, or straighten them again with a null value. */
    updateBends: (updates: Record<string, RelationBend | null>) => void;
    updateDescriptionsRaw: (descriptionsRaw: string | undefined) => void;
    updateRawContent: (newContent: string) => Promise<void>;
    resetLayout: () => Promise<void>;
    applyPlantUmlLayout: () => Promise<void>;
    applyTreemapLayout: () => void;
}

/**
 * The `.arch.md` editing model held in memory rather than in a file: the same
 * parse / mutate / serialize cycle as the archdia-edit plugin, but nothing is
 * written anywhere. The host commits `content` if and when the reader validates,
 * which is what lets a diagram embedded in a larger document be edited without
 * rewriting that document on every drag.
 *
 * A `plantuml` or `mermaid` block is translated into archdia on the way in, so
 * `content` is archdia from the first render — editing one of those is a
 * conversion, and the host writes the converted block back.
 *
 * Pass `null` to idle (the dialog is closed).
 */
export const useArchDiaDraft = (text: string | null, language: string = 'archdia'): ArchDiaDraft => {
    const [archDiaFile, setArchDiaFile] = useState<ArchDiaFile | null>(null);
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Raw-text edits arrive per keystroke and are parsed asynchronously; only
    // the newest parse may land, or a slow one would resurrect stale content.
    const rawEditSeq = useRef(0);

    useEffect(() => {
        if (text === null) {
            setArchDiaFile(null);
            setContent('');
            setError(null);
            setLoading(false);
            return;
        }

        let cancelled = false;

        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                // A block in another language is rewritten as archdia on the way
                // in, so from here on there is a single format to work with.
                const source = language === 'archdia' ? text : await importAsArchDia(language, text);

                // Preliminary parse to extract sources, then build the scene
                const preliminary = await parseArchDiaFile(source, EMPTY_SCENE);
                const scene = extractScene(getCombinedSource(preliminary));
                const parsed = await parseArchDiaFile(source, scene);
                if (cancelled) return;

                // A block whose content the parser does not recognise would come
                // back as an empty diagram, and validating would overwrite the
                // reader's own text with that emptiness. Refuse instead.
                if (parsed.sources.length === 0 && source.trim() !== '') {
                    setArchDiaFile(null);
                    setError(
                        'This block is not in the archdia block format (`---` frontmatter sections '
                        + 'separated by `===`), so editing it here would discard its content.',
                    );
                    return;
                }

                setArchDiaFile(parsed);
                setContent(source);
            } catch (e: any) {
                if (!cancelled) setError(e?.message || 'Failed to parse the diagram');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [text, language]);

    // Re-derive the scene from source on every archDiaFile change
    const scene = useMemo((): DiagramScene => {
        if (!archDiaFile) return EMPTY_SCENE;
        return extractScene(getCombinedSource(archDiaFile));
    }, [archDiaFile]);

    /** Adopt a new model and let it define the text to write back. */
    const commit = useCallback((newFile: ArchDiaFile) => {
        rawEditSeq.current += 1;
        setArchDiaFile(newFile);
        setContent(serializeArchDiaFile(newFile));
    }, []);

    const updateSource = useCallback(async (newSource: string) => {
        if (!archDiaFile) return;
        const newScene = extractScene(newSource);
        const reconciledLayout = await ensureAllPositions(archDiaFile.layout, newScene);
        commit({ sources: [{ source: newSource }], descriptionsRaw: archDiaFile.descriptionsRaw, layout: reconciledLayout });
    }, [archDiaFile, commit]);

    const updateDescriptionsRaw = useCallback((descriptionsRaw: string | undefined) => {
        if (!archDiaFile) return;
        commit({ ...archDiaFile, descriptionsRaw });
    }, [archDiaFile, commit]);

    const updateLayout = useCallback((layout: ArchDiaLayout) => {
        if (!archDiaFile) return;
        commit({ ...archDiaFile, layout });
    }, [archDiaFile, commit]);

    const updatePositions = useCallback((updates: Record<string, { x: number; y: number }>) => {
        if (!archDiaFile) return;
        const positions = { ...archDiaFile.layout.positions };
        for (const [id, pos] of Object.entries(updates)) {
            positions[id] = { ...positions[id], ...pos };
        }
        commit({ ...archDiaFile, layout: { ...archDiaFile.layout, positions } });
    }, [archDiaFile, commit]);

    /**
     * Writes down where relation centres have been put. A null drops the bend rather than storing
     * a nought, so a relation straightened again is the one that was never bent — and a block
     * whose every relation runs straight carries no `bends` at all.
     */
    const updateBends = useCallback((updates: Record<string, RelationBend | null>) => {
        if (!archDiaFile) return;
        const bends = { ...archDiaFile.layout.bends };
        for (const [key, bend] of Object.entries(updates)) {
            if (bend) bends[key] = bend; else delete bends[key];
        }
        commit({
            ...archDiaFile,
            layout: {
                ...archDiaFile.layout,
                bends: Object.keys(bends).length > 0 ? bends : undefined,
            },
        });
    }, [archDiaFile, commit]);

    const resetLayout = useCallback(async () => {
        if (!archDiaFile) return;
        setLoading(true);
        try {
            commit(await computeResetLayout(archDiaFile, scene));
        } finally {
            setLoading(false);
        }
    }, [archDiaFile, scene, commit]);

    const applyPlantUmlLayout = useCallback(async () => {
        if (!archDiaFile) return;
        setLoading(true);
        try {
            commit(await computePlantUml(archDiaFile, scene));
        } finally {
            setLoading(false);
        }
    }, [archDiaFile, scene, commit]);

    const applyTreemapLayout = useCallback(() => {
        if (!archDiaFile) return;
        commit(computeTreemap(archDiaFile, scene));
    }, [archDiaFile, scene, commit]);

    /**
     * The raw text view is the reader's own formatting: it is kept verbatim and
     * only mirrored into the model, so hand-written layout survives validation.
     */
    const updateRawContent = useCallback(async (newContent: string) => {
        const seq = ++rawEditSeq.current;
        setContent(newContent);
        try {
            const preliminary = await parseArchDiaFile(newContent, EMPTY_SCENE);
            const newScene = extractScene(getCombinedSource(preliminary));
            const parsed = await parseArchDiaFile(newContent, newScene);
            if (seq === rawEditSeq.current) setArchDiaFile(parsed);
        } catch (e) {
            // Half-typed text does not parse; keep drawing the last good model.
            console.error('ArchDia parse error:', e);
        }
    }, []);

    return {
        archDiaFile,
        scene,
        content,
        loading,
        error,
        updateSource,
        updateLayout,
        updatePositions,
        updateBends,
        updateDescriptionsRaw,
        updateRawContent,
        resetLayout,
        applyPlantUmlLayout,
        applyTreemapLayout,
    };
};
