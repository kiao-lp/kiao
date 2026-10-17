import { useState, useEffect, useMemo } from 'react';
import { useWorkerClient } from '@cms-core';
import { ArchDiaFile, DiagramScene, ArchDiaLayout, RelationBend, parseArchDiaFile, serializeArchDiaFile, getCombinedSource, ensureAllPositions, plantumlExtractor, resetLayout as computeResetLayout, applyPlantUmlLayout as computePlantUml, applyTreemapLayout as computeTreemap } from '@cms-kit/archdia';

export interface ArchDiaState {
    archDiaFile: ArchDiaFile | null;
    /** Diagram structure inferred from PlantUML — never persisted. */
    scene: DiagramScene;
    loading: boolean;
    error: string | null;
    updateSource: (newSource: string) => Promise<void>;
    updateLayout: (newLayout: ArchDiaLayout) => Promise<void>;

    /** Update multiple elements' positions at once. */
    updatePositions: (updates: Record<string, { x: number; y: number }>) => Promise<void>;
    /** Move relation centres, or straighten them again with a null value. */
    updateBends: (updates: Record<string, RelationBend | null>) => Promise<void>;
    /** Update the raw descriptions markdown. */
    updateDescriptionsRaw: (descriptionsRaw: string | undefined) => Promise<void>;
    updateRawContent: (newContent: string) => Promise<void>;
    resetLayout: () => Promise<void>;
    applyPlantUmlLayout: () => Promise<void>;
    applyTreemapLayout: () => Promise<void>;
}

const EMPTY_SCENE: DiagramScene = { components: [], containers: [], relations: [] };

/** Extract a DiagramScene from a combined PlantUML source string. */
function extractScene(combinedSource: string): DiagramScene {
    return {
        components: plantumlExtractor.extractComponents(combinedSource),
        containers: plantumlExtractor.extractContainers(combinedSource),
        relations: plantumlExtractor.extractRelations(combinedSource),
    };
}

/**
 * Hook that loads, parses, and optionally auto-saves an .arch.md file.
 *
 * Diagram structure (scene) is always re-derived from the PlantUML source.
 * Only positional data (layout) is persisted.
 */
export function useArchDiaState(filePath: string | undefined): ArchDiaState {
    const client = useWorkerClient();
    const [archDiaFile, setArchDiaFile] = useState<ArchDiaFile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!filePath) {
            setLoading(false);
            return;
        }

        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);
            try {
                const text = await client.getFileText(filePath!);
                const hasBlocks = text.includes('\n===\n');

                // Preliminary parse to extract sources, then build the scene
                const preliminary = await parseArchDiaFile(text, EMPTY_SCENE);
                const combinedSource = getCombinedSource(preliminary);
                const scene = extractScene(combinedSource);

                const parsed = await parseArchDiaFile(text, scene);

                if (!cancelled) {
                    setArchDiaFile(parsed);

                    // Auto-save if the layout block was missing
                    if (!hasBlocks) {
                        const serialized = serializeArchDiaFile(parsed);
                        await client.update(filePath!, serialized);
                    }
                }
            } catch (e: any) {
                if (!cancelled) {
                    setError(e.message || 'Failed to load file');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [filePath, client]);

    // Re-derive the scene from source on every archDiaFile change
    const scene = useMemo((): DiagramScene => {
        if (!archDiaFile) return EMPTY_SCENE;
        return extractScene(getCombinedSource(archDiaFile));
    }, [archDiaFile]);

    const updateSource = async (newSource: string) => {
        if (!archDiaFile || !filePath) return;

        // Re-extract scene, then reconcile layout for any new components
        const newScene = extractScene(newSource);
        const reconciledLayout = await ensureAllPositions(archDiaFile.layout, newScene);

        const newFile: ArchDiaFile = { sources: [{ source: newSource }], descriptionsRaw: archDiaFile.descriptionsRaw, layout: reconciledLayout };
        setArchDiaFile(newFile);
        await client.update(filePath, serializeArchDiaFile(newFile));
    };

    const updateDescriptionsRaw = async (newDescriptionsRaw: string | undefined) => {
        if (!archDiaFile || !filePath) return;
        const newFile: ArchDiaFile = { ...archDiaFile, descriptionsRaw: newDescriptionsRaw };
        setArchDiaFile(newFile);
        await client.update(filePath, serializeArchDiaFile(newFile));
    };

    const updateLayout = async (newLayout: ArchDiaLayout) => {
        if (!archDiaFile || !filePath) return;
        const newFile = { ...archDiaFile, layout: newLayout };
        setArchDiaFile(newFile);
        await client.update(filePath, serializeArchDiaFile(newFile));
    };



    const updatePositions = async (updates: Record<string, { x: number; y: number }>) => {
        if (!archDiaFile || !filePath) return;
        const newPositions = { ...archDiaFile.layout.positions };
        for (const [id, pos] of Object.entries(updates)) {
            const prev = newPositions[id];
            newPositions[id] = { ...prev, ...pos };
        }
        const newLayout: ArchDiaLayout = { ...archDiaFile.layout, positions: newPositions };
        const newFile = { ...archDiaFile, layout: newLayout };
        setArchDiaFile(newFile);
        await client.update(filePath, serializeArchDiaFile(newFile));
    };

    /**
     * Writes down where relation centres have been put. A null drops the bend rather than storing
     * a nought, so a relation straightened again is the one that was never bent — and a file whose
     * every relation runs straight carries no `bends` at all.
     */
    const updateBends = async (updates: Record<string, RelationBend | null>) => {
        if (!archDiaFile || !filePath) return;
        const newBends = { ...archDiaFile.layout.bends };
        for (const [key, bend] of Object.entries(updates)) {
            if (bend) newBends[key] = bend; else delete newBends[key];
        }
        const newLayout: ArchDiaLayout = { ...archDiaFile.layout, bends: Object.keys(newBends).length > 0 ? newBends : undefined };
        const newFile = { ...archDiaFile, layout: newLayout };
        setArchDiaFile(newFile);
        await client.update(filePath, serializeArchDiaFile(newFile));
    };

    const resetLayout = async () => {
        if (!archDiaFile || !filePath) return;
        setLoading(true);
        try {
            const newFile = await computeResetLayout(archDiaFile, scene);
            setArchDiaFile(newFile);
            await client.update(filePath, serializeArchDiaFile(newFile));
        } finally {
            setLoading(false);
        }
    };

    const applyPlantUmlLayout = async () => {
        if (!archDiaFile || !filePath) return;
        setLoading(true);
        try {
            const newFile = await computePlantUml(archDiaFile, scene);
            setArchDiaFile(newFile);
            await client.update(filePath, serializeArchDiaFile(newFile));
        } finally {
            setLoading(false);
        }
    };

    const applyTreemapLayout = async () => {
        if (!archDiaFile || !filePath) return;
        setLoading(true);
        try {
            const newFile = computeTreemap(archDiaFile, scene);
            setArchDiaFile(newFile);
            await client.update(filePath, serializeArchDiaFile(newFile));
        } finally {
            setLoading(false);
        }
    };

    const updateRawContent = async (newContent: string) => {
        if (!filePath) return;
        try {
            // Preliminary parse to extract sources, then build the scene
            const preliminary = await parseArchDiaFile(newContent, EMPTY_SCENE);
            const combinedSource = getCombinedSource(preliminary);
            const newScene = extractScene(combinedSource);

            const parsed = await parseArchDiaFile(newContent, newScene);
            setArchDiaFile(parsed);
            await client.update(filePath, newContent);
        } catch (e) {
            console.error('ArchDia template parse error:', e);
        }
    };

    return { archDiaFile, scene, loading, error, updateSource, updateLayout, updatePositions, updateBends, updateDescriptionsRaw, resetLayout, applyPlantUmlLayout, applyTreemapLayout, updateRawContent };
}
