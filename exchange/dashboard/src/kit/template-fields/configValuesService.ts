import { WorkerClient, FileDto } from 'kiao-worker';
import { KiaoElObject } from '@cms-kit/template-lang';

/**
 * Where a store keeps the value providers templates resolve against. It is an
 * ordinary content folder — hand-edited JSON, committed with the rest of the
 * store — and it is optional: a store that has never needed one simply has no
 * `kiao-user-config/` folder, and nothing here creates it. Only a store that actually gets
 * a value provider written into it grows the folder.
 */
const VALUES_PATH = 'kiao-user-config/values';

/**
 * Load a single JSON value provider file.
 * Returns empty array on any error.
 */
const loadValueFile = async (client: WorkerClient, path: string): Promise<KiaoElObject[]> => {
    try {
        const content = await client.getFileJson<KiaoElObject[]>(path);
        if (Array.isArray(content)) {
            return content;
        }
        console.warn(`[ConfigValues] File ${path} does not contain an array`);
        return [];
    } catch (error) {
        console.warn(`[ConfigValues] Failed to load ${path}:`, error);
        return [];
    }
};

/**
 * Load all value providers from the kiao-user-config/values folder.
 * Each .json file should contain an array of KiaoElObject items, written with their custom
 * fields grouped under `object` — `{ type, value, object: { ...fields } }`. An entry written
 * before the grouping, with its fields beside `type` and `value`, still reads: field lookup
 * falls back to the root.
 * Returns empty array if folder doesn't exist or no files found.
 */
export const loadAllValueProviders = async (client: WorkerClient): Promise<KiaoElObject[]> => {
    try {
        const files: FileDto[] = await client.listFiles(VALUES_PATH);
        const jsonFiles = files.filter(f => !f.isDirectory && f.path.endsWith('.json'));

        if (jsonFiles.length === 0) {
            return [];
        }

        const loadPromises = jsonFiles.map(file =>
            loadValueFile(client, file.path)
        );

        const results = await Promise.all(loadPromises);
        return results.flat();
    } catch (error) {
        console.warn('[ConfigValues] Failed to list value providers:', error);
        return [];
    }
};
