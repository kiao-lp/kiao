import type { Root, Element, RootContent } from 'hast';

/** Attribute carrying the 1-based markdown source line a rendered block starts at. */
export const SOURCE_LINE_ATTRIBUTE = 'data-source-line';

/**
 * Containers whose children are themselves blocks worth anchoring: recursing into
 * them turns a long list or table into many anchors instead of one, which keeps
 * source/preview alignment accurate inside them.
 */
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

/**
 * Records on each rendered top-level block the markdown line it came from, so the
 * editor/preview scroll sync can map source positions to rendered ones. Only blocks
 * are stamped — inline elements would add anchors that share their parent's vertical
 * position without refining it.
 */
export const rehypeSourceLine = () => (tree: Root): void => {
    stamp(tree.children);
};
