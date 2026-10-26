import type { Feature, Option, MoscowLevel } from './featmat-model';
import { supportLevel, supportComment } from './featmat-model';
import { SUPPORT_INFO, MOSCOW_INFO } from './featmat-constants';
import { computeCellScore, cellBackground, computeOptionScore } from './featmat-scoring';
import { markdownToHtml } from '@cms-kit/diagram-shared';

// ── Layout ──────────────────────────────────────────────────────────

const MIN_FEATURE_W = 200;
const MOSCOW_W = 150;
const MIN_OPTION_W = 120;
const HEADER_H_BASE = 76;       // height for a single-line option header
const HEADER_LABEL_LINE_H = 16; // extra height per additional label line
const ROW_H = 40;
const DESC_ROW_H = 50;
const LEGEND_H = 36;
const PAD = 12;
const CHAR_W = 8.4;          // approximate width of one char at 14px system-ui
const DESC_CHAR_W = 7.2;     // approximate width of one char at 12px system-ui
const DESC_LINE_H = 14;      // line height for description text
const MAX_DESC_LINES = 2;    // max lines before truncation
const TOOLTIP_W = 300;
const FONT = 'system-ui, -apple-system, sans-serif';
const BORDER = '#e0e0e0';
const HEADER_BG = '#f5f5f5';
const SCORE_CLR = '#1677ff';
const BAR_BG = '#e8e8e8';
const COMMENT_INDICATOR = 'rgba(0,120,215,0.6)';

const MOSCOW_TINT: Record<MoscowLevel, string> = {
    must: 'rgba(255,0,0,0.06)',
    should: 'rgba(255,140,0,0.06)',
    could: '#ffffff',
    wont: 'rgba(0,0,0,0.03)',
};

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Word-wrap text into lines that fit within maxW pixels, truncating with "…" beyond maxLines. */
function wrapText(text: string, maxW: number, charW: number, maxLines: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length * charW > maxW && current) {
            lines.push(current);
            if (lines.length >= maxLines) break;
            current = word;
        } else {
            current = candidate;
        }
    }

    if (lines.length < maxLines && current) {
        lines.push(current);
    } else if (lines.length === maxLines) {
        // Truncate last line if we have remaining text
        const last = lines[maxLines - 1];
        const maxChars = Math.floor(maxW / charW);
        if (current && current !== lines[maxLines - 1]) {
            // There's overflow — truncate last line with ellipsis
            const truncated = last.length > maxChars - 1 ? last.slice(0, maxChars - 1) + '\u2026' : last + '\u2026';
            lines[maxLines - 1] = truncated;
        } else if (last.length * charW > maxW) {
            lines[maxLines - 1] = last.slice(0, Math.floor(maxW / charW) - 1) + '\u2026';
        }
    }

    return lines;
}

// ── Generator ───────────────────────────────────────────────────────

export function generateFeatMatrixSvg(
    features: Feature[],
    options: Option[],
    moscow: Record<string, MoscowLevel>,
): string {
    // ── Compute sorted data (same logic as the component) ──
    const scoredOptions = options
        .map(opt => ({ opt, score: computeOptionScore(opt, features, moscow) }))
        .sort((a, b) => b.score - a.score);
    const maxScore = Math.max(1, scoredOptions[0]?.score ?? 1);

    const sortedFeatures = [...features].sort((a, b) =>
        MOSCOW_INFO[moscow[b.id] ?? 'could'].weight - MOSCOW_INFO[moscow[a.id] ?? 'could'].weight,
    );

    // ── Column widths ──
    const featureW = Math.max(MIN_FEATURE_W,
        ...features.map(f => f.label.length * CHAR_W + PAD * 2));
    const optionW = Math.max(MIN_OPTION_W,
        ...options.map(o => o.label.length * CHAR_W + PAD * 2));

    // ── Option header label wrapping & dynamic header height ──
    const optionLabelMaxW = optionW - PAD * 2;
    const wrappedOptionLabels = scoredOptions.map(({ opt }) =>
        wrapText(opt.label, optionLabelMaxW, CHAR_W, 2),
    );
    const maxOptionLabelLines = Math.max(1, ...wrappedOptionLabels.map(l => l.length));
    const HEADER_H = HEADER_H_BASE + (maxOptionLabelLines - 1) * HEADER_LABEL_LINE_H;
    // Score and bar are pinned from the bottom of the header:
    // score baseline at HEADER_H - 30, bar top at HEADER_H - 22
    const HEADER_SCORE_Y = HEADER_H - 30;
    const HEADER_BAR_Y = HEADER_H - 22;

    // ── Dimensions ──
    const nOpts = scoredOptions.length;
    const W = featureW + MOSCOW_W + nOpts * optionW;
    const descMaxW = featureW - PAD * 2;
    const wrappedDescs = sortedFeatures.map(f =>
        f.description ? wrapText(f.description, descMaxW, DESC_CHAR_W, MAX_DESC_LINES) : [],
    );
    const rowHeights = sortedFeatures.map((f, i) => {
        if (!f.description) return ROW_H;
        const nLines = wrappedDescs[i].length;
        return Math.max(DESC_ROW_H, 36 + nLines * DESC_LINE_H + 6);
    });
    const bodyH = rowHeights.reduce((s, h) => s + h, 0);
    const H = HEADER_H + bodyH + LEGEND_H;

    const o: string[] = [];
    const p = (s: string) => o.push(s);
    const tooltips: { id: string; html: string; x: number; y: number }[] = [];

    p(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`);
    p(`<rect width="${W}" height="${H}" fill="#fff"/>`);

    // ── Header row ──────────────────────────────────────────────────
    let x = 0;

    // Feature header
    p(`<rect x="${x}" y="0" width="${featureW}" height="${HEADER_H}" fill="${HEADER_BG}" stroke="${BORDER}"/>`);
    p(`<text x="${x + PAD}" y="${HEADER_H / 2 + 5}" font-family="${FONT}" font-size="14" font-weight="600">Feature</text>`);
    x += featureW;

    // Priority header
    p(`<rect x="${x}" y="0" width="${MOSCOW_W}" height="${HEADER_H}" fill="${HEADER_BG}" stroke="${BORDER}"/>`);
    p(`<text x="${x + PAD}" y="${HEADER_H / 2 + 5}" font-family="${FONT}" font-size="14" font-weight="600">Priority</text>`);
    x += MOSCOW_W;

    // Option headers
    for (let oi = 0; oi < scoredOptions.length; oi++) {
        const { opt, score } = scoredOptions[oi];
        const cx = x + optionW / 2;
        p(`<rect x="${x}" y="0" width="${optionW}" height="${HEADER_H}" fill="${HEADER_BG}" stroke="${BORDER}"/>`);
        const labelLines = wrappedOptionLabels[oi];
        for (let li = 0; li < labelLines.length; li++) {
            p(`<text x="${cx}" y="${22 + li * HEADER_LABEL_LINE_H}" font-family="${FONT}" font-size="14" font-weight="600" text-anchor="middle">${esc(labelLines[li])}</text>`);
        }
        p(`<text x="${cx}" y="${HEADER_SCORE_Y}" font-family="${FONT}" font-size="18" font-weight="700" fill="${SCORE_CLR}" text-anchor="middle">${score}</text>`);
        // score bar
        const bx = x + PAD;
        const bw = optionW - PAD * 2;
        const fw = (score / maxScore) * bw;
        p(`<rect x="${bx}" y="${HEADER_BAR_Y}" width="${bw}" height="4" rx="2" fill="${BAR_BG}"/>`);
        if (fw > 0) p(`<rect x="${bx}" y="${HEADER_BAR_Y}" width="${fw.toFixed(1)}" height="4" rx="2" fill="${SCORE_CLR}"/>`);
        x += optionW;
    }

    // ── Body rows ───────────────────────────────────────────────────
    let y = HEADER_H;
    for (let i = 0; i < sortedFeatures.length; i++) {
        const f = sortedFeatures[i];
        const rh = rowHeights[i];
        const level = moscow[f.id] ?? 'could';
        const mi = MOSCOW_INFO[level];
        const tint = MOSCOW_TINT[level];
        const isWont = level === 'wont';
        let x = 0;

        // Feature cell
        p(`<rect x="${x}" y="${y}" width="${featureW}" height="${rh}" fill="${tint}" stroke="${BORDER}"/>`);
        if (f.description) {
            const descLines = wrappedDescs[i];
            p(`<text x="${x + PAD}" y="${y + 20}" font-family="${FONT}" font-size="14" font-weight="500"${isWont ? ' opacity="0.5"' : ''}>${esc(f.label)}</text>`);
            for (let li = 0; li < descLines.length; li++) {
                p(`<text x="${x + PAD}" y="${y + 36 + li * DESC_LINE_H}" font-family="${FONT}" font-size="12" opacity="${isWont ? '0.35' : '0.7'}">${esc(descLines[li])}</text>`);
            }
        } else {
            p(`<text x="${x + PAD}" y="${y + rh / 2 + 5}" font-family="${FONT}" font-size="14" font-weight="500"${isWont ? ' opacity="0.5"' : ''}>${esc(f.label)}</text>`);
        }
        x += featureW;

        // Moscow cell — label instead of dropdown
        p(`<rect x="${x}" y="${y}" width="${MOSCOW_W}" height="${rh}" fill="${tint}" stroke="${BORDER}"/>`);
        p(`<text x="${x + PAD}" y="${y + rh / 2 + 5}" font-family="${FONT}" font-size="13">${esc(mi.label)}</text>`);
        x += MOSCOW_W;

        // Support cells
        for (const { opt } of scoredOptions) {
            const entry = opt.support[f.id];
            const supLevel = supportLevel(entry);
            const comment = supportComment(entry);
            const info = supLevel ? SUPPORT_INFO[supLevel] : undefined;
            const cs = computeCellScore(mi.weight, info?.score ?? 0);
            const tipId = `${opt.id}:${f.id}`;
            p(`<g${comment ? ` data-fm-id="${esc(tipId)}"` : ''}>`);
            p(`<rect x="${x}" y="${y}" width="${optionW}" height="${rh}" fill="${cellBackground(cs)}" stroke="${BORDER}"/>`);
            p(`<text x="${x + optionW / 2}" y="${y + rh / 2 + 6}" font-family="${FONT}" font-size="15" text-anchor="middle">${info ? info.emoji : '\u2014'}</text>`);
            if (comment) {
                // Corner indicator triangle
                p(`<polygon points="${x + optionW},${y} ${x + optionW - 8},${y} ${x + optionW},${y + 8}" fill="${COMMENT_INDICATOR}"/>`);
                tooltips.push({ id: tipId, html: markdownToHtml(comment), x: x + optionW, y });
            }
            p(`</g>`);
            x += optionW;
        }
        y += rh;
    }

    // ── Legend ───────────────────────────────────────────────────────
    let lx = PAD;
    const ly = y + LEGEND_H / 2 + 5;
    for (const [, { label, emoji }] of Object.entries(SUPPORT_INFO)) {
        p(`<text x="${lx}" y="${ly}" font-family="${FONT}" font-size="13" opacity="0.8">${emoji} ${esc(label)}</text>`);
        lx += label.length * 7.5 + 36;
    }

    // ── Tooltips (CSS :has() powered hover) ───────────────────────
    if (tooltips.length > 0) {
        const css = [
            `.fm-tip { display: none; pointer-events: none; }`,
            ...tooltips.map(t =>
                `svg:has([data-fm-id="${t.id}"]:hover) [data-fm-tip="${t.id}"] { display: block; }`
            ),
            `.fm-tip-body { width: max-content; max-width: ${TOOLTIP_W - 20}px; padding: 8px 12px; background: #fff; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); font-family: ${FONT}; font-size: 13px; line-height: 1.5; color: #333; white-space: normal; }`,
            `.fm-tip-body p { margin: 0 0 6px 0; }`,
            `.fm-tip-body p:last-child { margin-bottom: 0; }`,
            `.fm-tip-body h1,.fm-tip-body h2,.fm-tip-body h3,.fm-tip-body h4,.fm-tip-body h5,.fm-tip-body h6 { margin: 0 0 4px 0; font-size: 14px; font-weight: 600; }`,
            `.fm-tip-body ul,.fm-tip-body ol { margin: 0 0 6px 0; padding-left: 18px; }`,
            `.fm-tip-body code { background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; font-family: 'JetBrains Mono','Fira Code',monospace; font-size: 12px; }`,
            `.fm-tip-body a { color: ${SCORE_CLR}; text-decoration: none; }`,
        ];
        p(`<style>${css.join('\n')}</style>`);
        for (const t of tooltips) {
            const tx = t.x > W / 2 ? t.x - TOOLTIP_W : t.x;
            p(`<foreignObject x="${tx}" y="${t.y}" width="${TOOLTIP_W}" height="1" class="fm-tip" data-fm-tip="${esc(t.id)}" style="overflow:visible">`);
            p(`<div xmlns="http://www.w3.org/1999/xhtml" class="fm-tip-body">${t.html}</div>`);
            p(`</foreignObject>`);
        }
    }

    p('</svg>');
    return o.join('\n');
}

// ── Browser download helper ─────────────────────────────────────────

export function downloadSvgString(svg: string, filename = 'feature-matrix.svg'): void {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
