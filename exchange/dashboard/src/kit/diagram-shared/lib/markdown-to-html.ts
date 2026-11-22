/** Markdown to HTML for tooltip content, with no dependencies. Supports bold, italic, code, lists, links, headings, tables and paragraphs. */

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function inlineMarkdown(text: string): string {
    let s = escapeHtml(text);
    // Code spans are extracted first so formatting does not apply inside them.
    const codeSpans: string[] = [];
    s = s.replace(/`([^`]+)`/g, (_match, code) => {
        codeSpans.push(`<code>${code}</code>`);
        return `\x00CODE${codeSpans.length - 1}\x00`;
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic: single `*`, not part of `**`.
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/\x00CODE(\d+)\x00/g, (_match, idx) => codeSpans[parseInt(idx)]);
    return s;
}

/** For short tooltip texts, not full documents. */
export function markdownToHtml(markdown: string): string {
    if (!markdown) return '';

    const lines = markdown.split('\n');
    const htmlParts: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === '') {
            i++;
            continue;
        }

        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            htmlParts.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
            i++;
            continue;
        }

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

        if (/^\s*[-*]\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                items.push(inlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, '')));
                i++;
            }
            htmlParts.push('<ul>' + items.map(item => `<li>${item}</li>`).join('') + '</ul>');
            continue;
        }

        if (/^\s*\d+\.\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
                items.push(inlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, '')));
                i++;
            }
            htmlParts.push('<ol>' + items.map(item => `<li>${item}</li>`).join('') + '</ol>');
            continue;
        }

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
