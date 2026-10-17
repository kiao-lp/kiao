import { customAlphabet } from 'nanoid';

/** 22 lowercase alphanumerics; used as the library/progress key and build output filename. */
export const newDocId = (): string =>
    customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 22)();
