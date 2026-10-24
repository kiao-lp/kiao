import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import { DownOutlined, EyeInvisibleOutlined, UpOutlined } from '@ant-design/icons';
import { Tooltip } from '../ui/Tooltip';
import { revealPassage } from '../text-fragment/passageHighlight';
import { CRITICALITIES, Criticality, GateMatcher } from './matchers';
import { clearFindings, paintFindings } from './paintFindings';
import {
    countByCriticality,
    findingLabel,
    redactFinding,
    scanText,
    segmentText,
    stepIndex,
} from './scan';
import styles from './GatedTextView.module.css';

export interface GatedTextViewProps {
    /** The document's text: what the gate reads, what a redaction cuts into, and what is shown. */
    text: string;
    /** The gate to run over it; an empty one draws the text and no navigator. */
    matchers: GateMatcher[];
    /**
     * Draws the text as something other than source — the Markdown renderer, for a document that
     * is Markdown. The findings are then painted over whatever DOM it produces, through the CSS
     * Custom Highlight API, since that DOM belongs to React and nothing of ours may be put in it.
     */
    renderRich?: (text: string) => React.ReactNode;
    /**
     * Called with the text minus an obfuscated passage. Absent means the pane is read-only and the
     * obfuscate button is not offered.
     */
    onTextChange?: (next: string) => void;
    /**
     * What counts as "a different document". The walk starts over when it changes — and, crucially,
     * *not* when `text` changes, because obfuscating changes the text and the reviewer should come
     * back to where they were rather than to the top.
     */
    resetKey?: string;
    /** Extra classes for the reading pane, so a caller can size it as it likes. */
    className?: string;
    /**
     * The reading pane's test id. It is the pane and not the whole view, so the text a caller's
     * own tests assert on stays the text — the navigator over it is a sibling.
     */
    testId?: string;
}

/**
 * A text with the gate run over it: every finding painted at its criticality, a navigator to walk
 * them, and a button to take one out.
 *
 * The reason it exists is that nobody reads an eleven-page conversion of a scanned folder. What a
 * reviewer can do is answer "is there anything in here I should not import" — and that is a
 * question about a handful of spots in the text, not about the text. So the findings are counted
 * before they are read, the counts are the filter, and one button steps through them.
 *
 * **The colour is never the whole message.** Each level also carries its own underline and its own
 * word in the navigator, because a reviewer who cannot tell the red from the orange still has to be
 * able to tell a leaked key from a postcode.
 *
 * **The gate always reads the source.** Even where the preview is rendered Markdown, the scan, the
 * offsets and the redaction are the source text's — that is the file that will land in the store,
 * and it is the only thing a cut can be made in.
 */
export const GatedTextView: React.FC<GatedTextViewProps> = ({
    text, matchers, renderRich, onTextChange, resetKey, className, testId,
}) => {
    const [current, setCurrent] = useState(-1);
    const [level, setLevel] = useState<Criticality | null>(null);
    // One scroller, two possible elements under it — a <pre> of source or a rendered document — so
    // it is set by hand rather than typed to either.
    const scroller = useRef<HTMLElement | null>(null);
    const setScroller = (element: HTMLElement | null) => { scroller.current = element; };
    const rich = useRef<HTMLDivElement>(null);

    const scan = useMemo(() => scanText(text, matchers), [text, matchers]);
    const segments = useMemo(() => segmentText(text, scan.findings), [text, scan.findings]);
    const counts = useMemo(() => countByCriticality(scan.findings), [scan.findings]);

    // What the two buttons walk: every finding, or only one level's. Absolute indices throughout,
    // so filtering changes which findings are *reachable* and never what any of them is called.
    const walk = useMemo(
        () => scan.findings.map((finding, index) => ({ finding, index }))
            .filter(entry => level === null || entry.finding.matcher.criticality === level),
        [scan.findings, level]);

    // A different document, or a narrowed walk, starts before the first finding rather than on
    // whichever one happened to be numbered the same in the last one.
    useEffect(() => { setCurrent(-1); }, [resetKey ?? text, matchers, level]);

    // Obfuscating shortens the walk under the cursor, and the reviewer stays where they were —
    // which is now the finding that followed. Off the end, they go back to nowhere.
    const position = current >= 0 && current < walk.length ? current : -1;
    const at = position >= 0 ? walk[position] : null;

    // A `<pre>` is scrolled by its own marks; a rendered document is scrolled by the range painted
    // over it. Both leave the finding a third of the way down (see revealPassage).
    useEffect(() => {
        const pane = scroller.current;
        if (!pane) return;
        if (renderRich) {
            const container = rich.current;
            if (!container) return;
            const currentRange = paintFindings(container, scan.findings, at?.index ?? -1);
            if (currentRange) revealPassage(pane, currentRange);
            return;
        }
        // Switching from a rendered document to source leaves the registry holding ranges into
        // nodes that are gone. They paint nothing, and they should not be there either.
        clearFindings();
        if (!at) return;
        const mark = pane.querySelector<HTMLElement>(`[data-gate-index="${at.index}"]`);
        // offsetTop is measured against the pane, which the stylesheet makes the positioned
        // ancestor. A third of the way down leaves the finding's context above and below it.
        if (mark) pane.scrollTop = Math.max(0, mark.offsetTop - pane.clientHeight / 3);
    }, [at, renderRich, scan.findings, text]);

    // The highlights are registered on the document, not on this component, so leaving without
    // taking them off would paint a pane that is no longer there.
    useEffect(() => clearFindings, []);

    const step = useCallback((by: number) => setCurrent(previous => stepIndex(previous, walk.length, by)), [walk.length]);

    const toggle = (candidate: Criticality) => setLevel(previous => (previous === candidate ? null : candidate));

    const obfuscate = () => { if (at && onTextChange) onTextChange(redactFinding(text, at.finding)); };

    return (
        <div className={styles.view}>
            {matchers.length > 0 && (
                <div className={styles.navigator} data-testid="gate-navigator">
                    <div className={styles.counts}>
                        {scan.findings.length === 0
                            ? <span className={styles.clean} data-testid="gate-clean">Nothing the gate looks for</span>
                            : CRITICALITIES.filter(candidate => counts[candidate] > 0).map(candidate => (
                                <button
                                    key={candidate}
                                    type="button"
                                    className={`${styles.count} ${styles[candidate]} ${level === candidate ? styles.picked : ''}`}
                                    aria-pressed={level === candidate}
                                    onClick={() => toggle(candidate)}
                                    data-testid={`gate-count-${candidate}`}
                                >
                                    {counts[candidate]} {candidate}
                                </button>
                            ))}
                        {scan.truncated && (
                            <Tooltip title="The document is longer than the gate reads, or holds more findings than it lists. What is shown is a sample.">
                                <span className={styles.clean} data-testid="gate-truncated">partial</span>
                            </Tooltip>
                        )}
                    </div>
                    {walk.length > 0 && (
                        <div className={styles.steps}>
                            <span className={styles.position} data-testid="gate-position">
                                {position < 0 ? `${walk.length} found` : `${position + 1} / ${walk.length}`}
                            </span>
                            <Tooltip title="Previous finding">
                                <Button size="small" icon={<UpOutlined />} onClick={() => step(-1)}
                                    aria-label="Previous finding" data-testid="gate-previous" />
                            </Tooltip>
                            <Tooltip title="Next finding">
                                <Button size="small" icon={<DownOutlined />} onClick={() => step(1)}
                                    aria-label="Next finding" data-testid="gate-next" />
                            </Tooltip>
                            {onTextChange && (
                                <Tooltip title="Obfuscate this finding — it becomes [...] in the file that is imported">
                                    <Button
                                        size="small"
                                        icon={<EyeInvisibleOutlined />}
                                        disabled={!at}
                                        onClick={obfuscate}
                                        aria-label="Obfuscate this finding"
                                        data-testid="gate-obfuscate"
                                    />
                                </Tooltip>
                            )}
                        </div>
                    )}
                </div>
            )}
            {at && (
                <div className={styles.current} data-testid="gate-current">
                    <span className={`${styles.badge} ${styles[at.finding.matcher.criticality]}`}>
                        {at.finding.matcher.criticality}
                    </span>
                    <span className={styles.currentLabel}>{findingLabel(at.finding)}</span>
                    {at.finding.matcher.hint && <span className={styles.hint}>{at.finding.matcher.hint}</span>}
                </div>
            )}
            {renderRich
                ? <div ref={setScroller} className={`${styles.pane} ${className ?? ''}`} data-testid={testId ?? 'gate-text'}>
                    <div ref={rich} className={styles.rich}>{renderRich(text)}</div>
                </div>
                : <pre ref={setScroller} className={`${styles.pane} ${styles.source} ${className ?? ''}`} data-testid={testId ?? 'gate-text'}>
                    {segments.map((segment, index) => (segment.finding
                        ? <Tooltip key={index} title={findingLabel(segment.finding)}>
                            <mark
                                className={`${styles.finding} ${styles[segment.finding.matcher.criticality]} ${at?.index === segment.index ? styles.here : ''}`}
                                data-gate-index={segment.index}
                                data-testid={`gate-finding-${segment.index}`}
                            >{segment.text}</mark>
                        </Tooltip>
                        : <React.Fragment key={index}>{segment.text}</React.Fragment>))}
                </pre>}
        </div>
    );
};
