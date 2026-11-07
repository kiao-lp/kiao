import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tooltip } from '@cms-core';
import { ActivityLogSummary, formatClockDuration } from './activityLog';
import { ProjectColors, paintFor } from './projectColors';
import './ActivityLogBar.css';

const LABEL_PADDING = 12;

const UNDESCRIBED = 'no description';

export type ActivityLogBarProps = {
    date: string;
    summary: ActivityLogSummary;
    colors: ProjectColors;
};

/**
 * Proportion bar of a day's booked time, one segment per project.
 * The tooltip sits on the track so thin segments stay reachable.
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

    // Hidden labels stay laid out and measurable; this prevents ResizeObserver loops.
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
        // Keep the current row when the pointer crosses a gap.
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
