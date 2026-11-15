import { FileDto, extractName } from "./index";

export const parentPath = (path: string) => {
    const o = path.lastIndexOf("/");
    if (o === 0) return "/";
    return path.substring(0, o);
}

export const extractFileNameFn = (extension: string) => (file: FileDto) => {
    const name = extractName(file.path);
    return name.substring(0, name.length - extension.length);
}

export const extractFileNameAndExtension = (extensions: string[]) => (name: string) => {
    const extension = extensions
        .find(extension => name.endsWith(extension));

    if (!extension)
        return undefined;

    return [name.substring(0, name.length - extension.length), extension];
}

/** Rename selection: base name only when a known extension matches, else the whole name. Case-insensitive, matching plugin claims. */
export const renameSelectionRange = (name: string, extensions: string[]): { start: number; end: number } => {
    const lowerName = name.toLowerCase();
    const extension = extensions.find(ext => lowerName.endsWith(ext.toLowerCase()));

    if (!extension)
        return { start: 0, end: name.length };

    return { start: 0, end: name.length - extension.length };
}
