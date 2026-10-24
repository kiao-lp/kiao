import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileDto, WorkerClient } from 'kiao-worker';
import { IMPORT_GATE_PATH, loadImportGate } from './importGateConfig';

const entry = (name: string, isDirectory = false): FileDto =>
    ({ path: `${IMPORT_GATE_PATH}/${name}`, name, isDirectory } as unknown as FileDto);

const clientOf = (files: FileDto[], documents: Record<string, unknown>) => {
    const listFiles = vi.fn(async (path: string) => {
        if (path !== IMPORT_GATE_PATH) throw new Error(`unexpected listing of ${path}`);
        return files;
    });
    const getFileJson = vi.fn(async (path: string) => {
        if (!(path in documents)) throw new Error(`404 ${path}`);
        return documents[path];
    });
    return { client: { listFiles, getFileJson } as unknown as WorkerClient, listFiles, getFileJson };
};

const category = (name: string, criticality: string, label: string, pattern: string) => ({
    category: name, label: `The ${name} category`, criticality,
    matchers: [{ label, pattern }],
});

describe('loadImportGate', () => {
    beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
    afterEach(() => vi.restoreAllMocks());

    it('reads every category of the folder into one gate, worst first', async () => {
        const { client } = clientOf(
            [entry('hr.json'), entry('secrets.json')],
            {
                [`${IMPORT_GATE_PATH}/hr.json`]: category('hr', 'high', 'salary', 'salaire'),
                [`${IMPORT_GATE_PATH}/secrets.json`]: category('secrets', 'critical', 'key', 'AKIA'),
            });

        const gate = await loadImportGate(client);

        expect(gate.map(m => `${m.category}/${m.label}`)).toEqual(['secrets/key', 'hr/salary']);
    });

    it('ignores what is not a category document', async () => {
        const { client, getFileJson } = clientOf(
            [entry('README.md'), entry('drafts', true), entry('secrets.json')],
            { [`${IMPORT_GATE_PATH}/secrets.json`]: category('secrets', 'critical', 'key', 'AKIA') });

        expect(await loadImportGate(client)).toHaveLength(1);
        expect(getFileJson).toHaveBeenCalledTimes(1);
    });

    // A store served by a build that never seeded the folder, or one whose folder was deleted.
    // The review still opens and still reads; it simply highlights nothing.
    it('is the empty gate when the folder is not there', async () => {
        const listFiles = vi.fn(async () => { throw new Error('404'); });
        expect(await loadImportGate({ listFiles } as unknown as WorkerClient)).toEqual([]);
    });

    it('loses only the category it could not read', async () => {
        const { client } = clientOf(
            [entry('broken.json'), entry('secrets.json')],
            { [`${IMPORT_GATE_PATH}/secrets.json`]: category('secrets', 'critical', 'key', 'AKIA') });

        expect(await loadImportGate(client)).toHaveLength(1);
    });
});
