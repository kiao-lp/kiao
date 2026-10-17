import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tooltip } from '@cms-core';
import { ActivityLogSummary, formatClockDuration } from './activityLog';
import { ProjectColors, paintFor } from './projectColors';
import './ActivityLogBar.css';

/** Room a label needs on either side of its text to sit comfortably in a segment. */
const LABEL_PADDING = 12;

/** Stands in for the description of time booked without one, so its line still reads. */
const UNDESCRIBED = 'no description';

export type ActivityLogBarProps = {
    /** The day this bar covers, shown as the heading of the detail tooltip. */
    date: string;
    summary: ActivityLogSummary;
    colors: ProjectColors;
};

/**
 * The day's booked time as one full-width proportion bar, a segment per project.
 *
 * The bar always fills its track, so it reads as shares of the day; the day's
 * size is carried by the total next to it. Detail arrives three ways, in
 * descending order of effort: a label written inside every segment wide enough
 * to hold it, a tooltip covering the whole day, and the accessible name.
 *
 * The tooltip sits on the track rather than on each segment, so a three-minute
 * entry stays reachable however thin its segment gets — the pointer's position
 * picks the row to emphasize, and opens what was done on that project underneath
 * it.
 */
export const ActivityLogBar: React.FC<ActivityLogBarProps> = ({ date, summary, colors }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [fits, setFits] = useState<boolean[]>([]);
    const [hovered, setHovered] = useState<number | null>(null);
    const { projects, totalMinutes } = summary;

    const paints = useMemo(
        () => projects.map(({ project }) => paintFor(project, colors)),
        [projects, colors],
    );

    // A label is written inside its segment only when it fits whole. Hiding it
    // keeps it laid out, so it stays measurable and the track never resizes in
    // response — which is what keeps the observer below from looping.
    useLayoutEffect(() => {
        const track = trackRef.current;
        if (!track) return;
        const measure = () => {
            const measured = [...track.querySelectorAll<HTMLElement>('[data-segment]')].map(segment => {
                const label = segment.firstElementChild;
                return label instanceof HTMLElement && label.scrollWidth + LABEL_PADDING <= segment.clientWidth;
            });
            setFits(current => current.length === measured.length && measured.every((fit, index) => fit === current[index])
                ? current
                : measured);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(track);
        return () => observer.disconnect();
    }, [projects]);

    if (projects.length === 0 || totalMinutes <= 0) return null;

    const trackHover = (event: React.MouseEvent<HTMLDivElement>) => {
        const segment = (event.target as HTMLElement).closest<HTMLElement>('[data-segment]');
        // The pointer is crossing a gap between two segments: leave the
        // emphasis where it was rather than flickering it off.
        if (!segment) return;
        const index = Number(segment.dataset.segment);
        if (index !== hovered) setHovered(index);
    };

    const shareOf = (minutes: number) => Math.round((minutes / totalMinutes) * 100);
    const label = ({ project, minutes }: { project: string; minutes: number }) =>
        `${project} ${formatClockDuration(minutes)}`;

    const detail = <div className="activity-log-bar__tip">
        <div className="activity-log-bar__tip-head">
            <span>{date}</span>
            <span>total {formatClockDuration(totalMinutes)}</span>
        </div>
        {projects.map((entry, index) => <React.Fragment key={entry.project}>
            <div className={`activity-log-bar__tip-row${index === hovered ? ' activity-log-bar__tip-row--hovered' : ''}`}>
                <span className="activity-log-bar__swatch" style={{ background: paints[index].fill }} />
                <span className="activity-log-bar__tip-project">{entry.project}</span>
                <span className="activity-log-bar__tip-time">{formatClockDuration(entry.minutes)}</span>
                <span className="activity-log-bar__tip-share">{shareOf(entry.minutes)}%</span>
            </div>
            {index === hovered && <div className="activity-log-bar__tip-done">
                {entry.activities.map(activity => <div key={activity.description} className="activity-log-bar__tip-done-row">
                    <span className="activity-log-bar__tip-done-what">{activity.description || UNDESCRIBED}</span>
                    <span className="activity-log-bar__tip-done-time">{formatClockDuration(activity.minutes)}</span>
                </div>)}
            </div>}
        </React.Fragment>)}
    </div>;

    return <Tooltip title={detail} mouseEnterDelay={0.15} placement="bottom"
        classNames={{ root: 'activity-log-bar__tip-root' }}>
        <div ref={trackRef} className="activity-log-bar" role="img"
            aria-label={`${projects.map(label).join(', ')} — total ${formatClockDuration(totalMinutes)}`}
            onMouseMove={trackHover} onMouseLeave={() => setHovered(null)}>
            {projects.map((entry, index) => <div key={entry.project} data-segment={index}
                className="activity-log-bar__segment"
                style={{ flexGrow: entry.minutes, background: paints[index].fill }}>
                <span className="activity-log-bar__label"
                    style={{ color: paints[index].ink, visibility: fits[index] ? 'visible' : 'hidden' }}>
                    {label(entry)}
                </span>
            </div>)}
        </div>
    </Tooltip>;
};
