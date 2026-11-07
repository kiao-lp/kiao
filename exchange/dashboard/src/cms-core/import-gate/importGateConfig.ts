import { WorkerClient } from 'kiao-worker';
import { GateMatcher, parseCategory, sortMatchers } from './matchers';

/** Store-root folder. Each `.json` file is a category. */
export const IMPORT_GATE_PATH = 'kiao-user-config/import-gate';

/** Reloads on each import. Missing folder yields an empty gate. */
export const loadImportGate = async (client: WorkerClient): Promise<GateMatcher[]> => {
    let files;
    try {
        files = await client.listFiles(IMPORT_GATE_PATH);
    } catch {
        return [];
    }
    const categories = files.filter(file => !file.isDirectory && file.path.toLowerCase().endsWith('.json'));
    const loaded = await Promise.all(categories.map(async file => {
        const name = file.path.substring(file.path.lastIndexOf('/') + 1);
        try {
            return parseCategory(name, await client.getFileJson<unknown>(file.path));
        } catch (error) {
            console.warn(`[import-gate] ${file.path} could not be read`, error);
            return [];
        }
    }));
    return sortMatchers(loaded.flat());
};
