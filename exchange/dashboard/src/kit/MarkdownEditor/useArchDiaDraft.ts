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
} from '@kiao-dashboard-kit/archdia';

const EMPTY_SCENE: DiagramScene = { components: [], containers: [], relations: [] };

const extractScene = (combinedSource: string): DiagramScene => ({
    components: plantumlExtractor.extractComponents(combinedSource),
    containers: plantumlExtractor.extractContainers(combinedSource),
    relations: plantumlExtractor.extractRelations(combinedSource),
});

export interface ArchDiaDraft {
    archDiaFile: ArchDiaFile | null;
    /** Inferred from PlantUML; never persisted. */
    scene: DiagramScene;
    /** Text to write back: re-serialized model or raw editor text. */
    content: string;
    loading: boolean;
    error: string | null;
    updateSource: (newSource: string) => Promise<void>;
    updateLayout: (newLayout: ArchDiaLayout) => void;
    updatePositions: (updates: Record<string, { x: number; y: number }>) => void;
    /** Move relation centres; null straightens. */
    updateBends: (updates: Record<string, RelationBend | null>) => void;
    updateDescriptionsRaw: (descriptionsRaw: string | undefined) => void;
    updateRawContent: (newContent: string) => Promise<void>;
    resetLayout: () => Promise<void>;
    applyPlantUmlLayout: () => Promise<void>;
    applyTreemapLayout: () => void;
}

/** In-memory `.arch.md` draft; the host commits `content` only on validation. `plantuml`/`mermaid` input is converted to archdia; `null` idles. */
export const useArchDiaDraft = (text: string | null, language: string = 'archdia'): ArchDiaDraft => {
    const [archDiaFile, setArchDiaFile] = useState<ArchDiaFile | null>(null);
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Only the newest async parse may land; a slow parse would restore stale content.
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
                const source = language === 'archdia' ? text : await importAsArchDia(language, text);

                const preliminary = await parseArchDiaFile(source, EMPTY_SCENE);
                const scene = extractScene(getCombinedSource(preliminary));
                const parsed = await parseArchDiaFile(source, scene);
                if (cancelled) return;

                // Unrecognised non-empty source parses as empty; refuse, or validation would overwrite it.
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

    const scene = useMemo((): DiagramScene => {
        if (!archDiaFile) return EMPTY_SCENE;
        return extractScene(getCombinedSource(archDiaFile));
    }, [archDiaFile]);

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

    // Null deletes the bend; no `bends` are stored if all relations are straight.
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

    // Raw text is kept verbatim and mirrored into the model, so hand-written formatting survives.
    const updateRawContent = useCallback(async (newContent: string) => {
        const seq = ++rawEditSeq.current;
        setContent(newContent);
        try {
            const preliminary = await parseArchDiaFile(newContent, EMPTY_SCENE);
            const newScene = extractScene(getCombinedSource(preliminary));
            const parsed = await parseArchDiaFile(newContent, newScene);
            if (seq === rawEditSeq.current) setArchDiaFile(parsed);
        } catch (e) {
            // Unparsable partial text: keep the last good model.
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
