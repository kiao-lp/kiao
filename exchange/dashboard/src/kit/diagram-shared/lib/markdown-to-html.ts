/**
 * Lightweight markdown-to-HTML converter for tooltip content.
 * Zero external dependencies — supports the subset of markdown
 * useful for diagram description tooltips.
 *
 * Supported syntax:
 *  - Bold (**text**)
 *  - Italic (*text*)
 *  - Inline code (`code`)
 *  - Unordered lists (- item / * item)
 *  - Ordered lists (1. item)
 *  - Paragraphs (blank-line separated)
 *  - Links ([text](url))
 *  - Headings (# through ######)
 *  - Tables (GFM pipe tables)
 *  - Line breaks (trailing double space or \n within a paragraph)
 */

/** Escape HTML special characters. */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Apply inline markdown formatting to a single line of text. */
function inlineMarkdown(text: string): string {
    let s = escapeHtml(text);
    // Extract inline code spans before other formatting (prevent bold/italic inside code)
    const codeSpans: string[] = [];
    s = s.replace(/`([^`]+)`/g, (_match, code) => {
        codeSpans.push(`<code>${code}</code>`);
        return `\x00CODE${codeSpans.length - 1}\x00`;
    });
    // Bold
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic (single * not preceded/followed by space, avoiding conflict with bold)
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Links
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Restore code spans
    s = s.replace(/\x00CODE(\d+)\x00/g, (_match, idx) => codeSpans[parseInt(idx)]);
    return s;
}

/**
 * Convert a markdown string to an HTML string.
 *
 * Designed for short description texts (tooltips), not full documents.
 */
export function markdownToHtml(markdown: string): string {
    if (!markdown) return '';

    const lines = markdown.split('\n');
    const htmlParts: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Blank line — skip (paragraph separation is handled by grouping)
        if (line.trim() === '') {
            i++;
            continue;
        }

        // Heading
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            htmlParts.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
            i++;
            continue;
        }

        // Table (GFM pipe table: header row, separator row, body rows)
        if (
            /^\s*\|.*\|\s*$/.test(line) &&
            i + 1 < lines.length &&
            /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])
        ) {
            const splitRow = (row: string): string[] =>
                row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
            const aligns = splitRow(lines[i + 1]).map(c => {
                const left = c.startsWith(':');
                const right = c.endsWith(':');
                if (left && right) return 'center';
                if (right) return 'right';
                if (left) return 'left';
                return null;
            });
            const headers = splitRow(line);
            i += 2;
            const rows: string[][] = [];
            while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
                rows.push(splitRow(lines[i]));
                i++;
            }
            const styleAttr = (idx: number) =>
                aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
            const thead =
                '<thead><tr>' +
                headers.map((h, idx) => `<th${styleAttr(idx)}>${inlineMarkdown(h)}</th>`).join('') +
                '</tr></thead>';
            const tbody =
                '<tbody>' +
                rows
                    .map(
                        r =>
                            '<tr>' +
                            r
                                .map((c, idx) => `<td${styleAttr(idx)}>${inlineMarkdown(c)}</td>`)
                                .join('') +
                            '</tr>',
                    )
                    .join('') +
                '</tbody>';
            htmlParts.push(`<table>${thead}${tbody}</table>`);
            continue;
        }

        // Unordered list
        if (/^\s*[-*]\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                items.push(inlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, '')));
                i++;
            }
            htmlParts.push('<ul>' + items.map(item => `<li>${item}</li>`).join('') + '</ul>');
            continue;
        }

        // Ordered list
        if (/^\s*\d+\.\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
                items.push(inlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, '')));
                i++;
            }
            htmlParts.push('<ol>' + items.map(item => `<li>${item}</li>`).join('') + '</ol>');
            continue;
        }

        // Paragraph — collect consecutive non-blank, non-special lines
        const paraLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== '' && !/^#{1,6}\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) {
            paraLines.push(inlineMarkdown(lines[i]));
            i++;
        }
        if (paraLines.length > 0) {
            htmlParts.push(`<p>${paraLines.join('<br/>')}</p>`);
        }
    }

    return htmlParts.join('');
}
