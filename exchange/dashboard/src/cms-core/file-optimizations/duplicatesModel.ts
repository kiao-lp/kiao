/**
 * The server groups distinct paths by identical bytes. Choose the survivor's folder and
 * name independently from the group's distinct folders and names, not from whole rows.
 * Preset only a half with one option. Distinct paths cannot share both folder and name,
 * so every group requires an explicit choice before consolidation.
 */

import type { DuplicateGroup, FileDto } from 'kiao-worker';

export interface KeepChoice {
    folder?: string;
    name?: string;
}

/** The store root is represented by "". */
export const folderOf = (path: string): string => {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? '' : path.slice(0, slash);
};

export const nameOf = (path: string): string => {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? path : path.slice(slash + 1);
};

export const folderLabel = (folder: string): string => folder === '' ? '/' : folder;

const distinct = (values: string[]): string[] => Array.from(new Set(values));

/** Distinct folders in first-occurrence order. */
export const foldersOf = (files: FileDto[]): string[] => distinct(files.map(f => folderOf(f.path)));

/** Distinct names in first-occurrence order. */
export const namesOf = (files: FileDto[]): string[] => distinct(files.map(f => nameOf(f.path)));

export const presetChoice = (files: FileDto[]): KeepChoice => {
    const folders = foldersOf(files);
    const names = namesOf(files);
    return {
        ...(folders.length === 1 ? { folder: folders[0] } : {}),
        ...(names.length === 1 ? { name: names[0] } : {}),
    };
};

/** Stored choices already include the preset half; no merge is needed. */
export const choiceOf = (group: DuplicateGroup, choices: Record<string, KeepChoice>): KeepChoice =>
    choices[group.hash] ?? presetChoice(group.files);

export const targetOf = (choice: KeepChoice): string | null => {
    if (choice.folder === undefined || !choice.name) return null;
    return choice.folder === '' ? choice.name : `${choice.folder}/${choice.name}`;
};

export const canKeepOnlyOne = (choice: KeepChoice): boolean => targetOf(choice) !== null;

/** Consolidation moves these paths to the survivor and repoints references; bytes are retained. */
export const removedBy = (paths: string[], target: string): string[] =>
    paths.filter(p => p !== target);

export const staysPut = (paths: string[], target: string): boolean =>
    paths.includes(target);

/** Retain wasted bytes for the result summary: consolidation invalidates the source group. */
export interface Consolidation {
    /** Content hash used as the choice key. */
    hash: string;
    paths: string[];
    target: string;
    wasted: number;
}

export interface ConsolidationOutcome {
    target: string;
    removed: string[];
    /** A failure affects only this group; the rest of the plan still ran. */
    error?: string;
}

/** Include only fully chosen groups, in display order; unfinished groups do not block the plan. */
export const chosenConsolidations = (
    groups: DuplicateGroup[],
    choices: Record<string, KeepChoice>,
): Consolidation[] =>
    groups.flatMap(group => {
        const target = targetOf(choiceOf(group, choices));
        if (!target) return [];
        return [{ hash: group.hash, paths: group.files.map(f => f.path), target, wasted: group.wasted }];
    });

export const plannedWasted = (plan: Consolidation[]): number =>
    plan.reduce((sum, c) => sum + c.wasted, 0);

/** Base-1024 sizes, displayed with KB/MB/GB/TB labels. */
export const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

export const totalWasted = (groups: DuplicateGroup[]): number =>
    groups.reduce((sum, g) => sum + g.wasted, 0);
