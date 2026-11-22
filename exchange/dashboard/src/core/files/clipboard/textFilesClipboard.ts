import { WorkerClient, extractName } from '../service';
import { isReadableAsText } from '../service/textFiles';
import { duplicateName } from '../core/duplicateName';

export interface TextClipboardFile {
    name: string;
    content: string;
}

const validFile = (file: unknown): file is TextClipboardFile => {
    if (!file || typeof file !== 'object') return false;
    const { name, content } = file as TextClipboardFile;
    return typeof name === 'string' && name.trim().length > 0
        && name !== '.' && name !== '..' && !/[\x00-\x1f/\\]/.test(name)
        && typeof content === 'string' && !content.includes('\0');
};

const validateTextFiles = (files: TextClipboardFile[]): void => {
    if (files.length === 0 || !files.every(validFile)) throw new Error('Invalid text files');
};

/** A versioned text/plain envelope travels through the OS clipboard across origins. */
export const serializeTextFiles = (files: TextClipboardFile[]): string => {
    validateTextFiles(files);
    return JSON.stringify({ kind: 'kiao-text-files', version: 1, files }, null, 2);
};

export const parseTextFiles = (text: string): TextClipboardFile[] | null => {
    try {
        const data = JSON.parse(text);
        if (data?.kind !== 'kiao-text-files' || data.version !== 1
            || !Array.isArray(data.files) || data.files.length === 0
            || !data.files.every(validFile)) return null;
        return data.files.map(({ name, content }: TextClipboardFile) => ({ name, content }));
    } catch {
        return null;
    }
};

export const readTextFiles = async (client: WorkerClient, paths: string[]): Promise<TextClipboardFile[]> => {
    const files: TextClipboardFile[] = [];
    for (const path of paths) {
        const info = await client.getFileMetadata(path);
        if (info.isDirectory || !isReadableAsText(path)) throw new Error(`${extractName(path)} is not a text file`);
        const blob = await client.getFileBlob(path);
        // Fatal decoding refuses binary data; ignoreBOM keeps a UTF-8 BOM in the copied text.
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await blob.arrayBuffer());
        files.push({ name: extractName(path), content });
    }
    validateTextFiles(files);
    return files;
};

export const pasteTextFiles = async (
    client: WorkerClient,
    files: TextClipboardFile[],
    targetFolder: string,
    knownExtensions: string[],
): Promise<number> => {
    validateTextFiles(files);
    const taken = (await client.listFiles(targetFolder)).map(file => extractName(file.path));
    const staging = await client.createStaging();
    try {
        const items = [];
        for (const [index, file] of files.entries()) {
            const name = taken.includes(file.name) ? duplicateName(file.name, taken, knownExtensions) : file.name;
            taken.push(name);
            const folder = `${staging.path}/${index}`;
            await client.upload(folder, file.content, { filename: file.name });
            items.push({ from: `${folder}/${file.name}`, to: targetFolder ? `${targetFolder}/${name}` : name });
        }
        // Worker resolves remaining collisions, including entries hidden from the listing.
        const results = await client.copyBatch({ items });
        return results.length;
    } finally {
        await client.discardStaging(staging.path).catch(error => console.error('Could not discard clipboard staging', error));
    }
};
