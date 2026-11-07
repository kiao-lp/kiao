import type { Root, Element, RootContent } from 'hast';

/** 1-based source line of a rendered block. */
export const SOURCE_LINE_ATTRIBUTE = 'data-source-line';

/** Containers recursed into for finer anchors. */
const CONTAINERS = new Set(['ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody']);

const stamp = (nodes: RootContent[]): void => {
    for (const node of nodes) {
        if (node.type !== 'element') continue;
        const element = node as Element;
        const line = element.position?.start.line;
        if (line !== undefined) {
            element.properties = { ...element.properties, [SOURCE_LINE_ATTRIBUTE]: line };
        }
        if (CONTAINERS.has(element.tagName)) {
            stamp(element.children);
        }
    }
};

/** Stamps each block with its source line for scroll sync. Blocks only. */
export const rehypeSourceLine = () => (tree: Root): void => {
    stamp(tree.children);
};
