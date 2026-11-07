import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import { DownOutlined, EyeInvisibleOutlined, UpOutlined } from '@ant-design/icons';
import { Tooltip } from '../ui-foundation/feedback/Tooltip';
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
    text: string;
    /** Empty gate draws text with no navigator. */
    matchers: GateMatcher[];
    /** Custom renderer (e.g. Markdown); findings paint via the Highlight API. */
    renderRich?: (text: string) => React.ReactNode;
    /** Receives text minus the obfuscated passage. Absent: read-only, no obfuscate button. */
    onTextChange?: (next: string) => void;
    /** Document identity. Walk resets when it changes, not when `text` changes. */
    resetKey?: string;
    className?: string;
    /** Test id of the reading pane only. */
    testId?: string;
}

/** Counts filter findings; the navigator steps through them. Offsets and redaction use source text. */
export const GatedTextView: React.FC<GatedTextViewProps> = ({
    text, matchers, renderRich, onTextChange, resetKey, className, testId,
}) => {
    const [current, setCurrent] = useState(-1);
    const [level, setLevel] = useState<Criticality | null>(null);
    // Untyped: holds either a <pre> or a rendered document.
    const scroller = useRef<HTMLElement | null>(null);
    const setScroller = (element: HTMLElement | null) => { scroller.current = element; };
    const rich = useRef<HTMLDivElement>(null);

    const scan = useMemo(() => scanText(text, matchers), [text, matchers]);
    const segments = useMemo(() => segmentText(text, scan.findings), [text, scan.findings]);
    const counts = useMemo(() => countByCriticality(scan.findings), [scan.findings]);

    // Absolute indices; filtering changes reachability only.
    const walk = useMemo(
        () => scan.findings.map((finding, index) => ({ finding, index }))
            .filter(entry => level === null || entry.finding.matcher.criticality === level),
        [scan.findings, level]);

    useEffect(() => { setCurrent(-1); }, [resetKey ?? text, matchers, level]);

    // After obfuscation the cursor stays on the following finding, or nowhere off the end.
    const position = current >= 0 && current < walk.length ? current : -1;
    const at = position >= 0 ? walk[position] : null;

    // Target sits one third down the pane.
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
        clearFindings();
        if (!at) return;
        const mark = pane.querySelector<HTMLElement>(`[data-gate-index="${at.index}"]`);
        // offsetTop is relative to the positioned pane.
        if (mark) pane.scrollTop = Math.max(0, mark.offsetTop - pane.clientHeight / 3);
    }, [at, renderRich, scan.findings, text]);

    // Highlights live on the document; remove them on unmount.
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
