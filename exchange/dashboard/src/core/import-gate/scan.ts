import { Criticality, GateMatcher, criticalityRank } from './matchers';

export interface GateFinding {
    /** Half-open offsets into the source text. */
    start: number;
    end: number;
    text: string;
    matcher: GateMatcher;
}

/** Caps UI-thread work. */
export const MAX_SCAN_CHARS = 120_000;

/** Caps one rule's findings. */
const MAX_PER_MATCHER = 300;

const MAX_FINDINGS = 3_000;

export interface GateScan {
    findings: GateFinding[];
    /** Text exceeded {@link MAX_SCAN_CHARS}, or a finding cap was reached. */
    truncated: boolean;
}

/** Overlap winner: earliest start, then worst criticality, then longest. */
export const scanText = (text: string, matchers: GateMatcher[]): GateScan => {
    const scanned = text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
    let truncated = scanned.length < text.length;
    const found: GateFinding[] = [];

    for (const matcher of matchers) {
        // Matchers are shared across documents; reset lastIndex before and after scanning.
        matcher.regex.lastIndex = 0;
        let hits = 0;
        let match: RegExpExecArray | null;
        while ((match = matcher.regex.exec(scanned)) !== null) {
            // Empty matches do not advance RegExp.exec on their own.
            if (match[0].length === 0) {
                matcher.regex.lastIndex += 1;
                continue;
            }
            found.push({ start: match.index, end: match.index + match[0].length, text: match[0], matcher });
            if (++hits >= MAX_PER_MATCHER || found.length >= MAX_FINDINGS) {
                truncated = true;
                break;
            }
        }
        matcher.regex.lastIndex = 0;
        if (found.length >= MAX_FINDINGS) break;
    }

    found.sort((a, b) =>
        a.start - b.start
        || criticalityRank(a.matcher.criticality) - criticalityRank(b.matcher.criticality)
        || (b.end - b.start) - (a.end - a.start)
        || a.matcher.id.localeCompare(b.matcher.id));

    const findings: GateFinding[] = [];
    let reached = 0;
    for (const finding of found) {
        if (finding.start < reached) continue;
        findings.push(finding);
        reached = finding.end;
    }
    return { findings, truncated };
};

export interface GateSegment {
    text: string;
    finding?: GateFinding;
    /** Index in the scan's findings, shared by navigator and highlight. */
    index?: number;
}

/** Covers the full text, including the unscanned tail. */
export const segmentText = (text: string, findings: GateFinding[]): GateSegment[] => {
    const segments: GateSegment[] = [];
    let at = 0;
    findings.forEach((finding, index) => {
        if (finding.start > at) segments.push({ text: text.slice(at, finding.start) });
        segments.push({ text: text.slice(finding.start, finding.end), finding, index });
        at = finding.end;
    });
    if (at < text.length) segments.push({ text: text.slice(at) });
    return segments;
};

export const countByCriticality = (findings: GateFinding[]): Record<Criticality, number> => {
    const counts: Record<Criticality, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of findings) counts[finding.matcher.criticality] += 1;
    return counts;
};

/** Wraps. From -1: forward goes to first, backward to last. */
export const stepIndex = (current: number, total: number, step: number): number => {
    if (total === 0) return -1;
    if (current < 0) return step > 0 ? 0 : total - 1;
    return (current + step + total) % total;
};

export const findingLabel = (finding: GateFinding): string =>
    `${finding.matcher.categoryLabel} · ${finding.matcher.label}`;

export const OBFUSCATED = '[...]';

/** Offsets index source text. Re-scan after redaction. */
export const redactFinding = (text: string, finding: GateFinding): string =>
    text.slice(0, finding.start) + OBFUSCATED + text.slice(finding.end);
