import { DraggedFile, markdownLinksOf } from '@cms-core';

/** Append links, separated from existing text by a markdown paragraph break. */
export const contentWithDroppedFiles = (content: string, files: DraggedFile[]): string => {
    const links = markdownLinksOf(files);
    const said = content.trimEnd();
    return said ? `${said}\n\n${links}` : links;
};
