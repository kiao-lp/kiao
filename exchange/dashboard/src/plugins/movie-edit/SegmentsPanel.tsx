import React, { useEffect, useState } from 'react';
import { Button, Input, Popconfirm, Spin } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { extractName, Tooltip } from '@cms-core';
import { useMovieEditOptional, type MovieEditValue } from './MovieEdit-ctx';
import { SaveSegmentsButton, SaveSegmentsStatus } from './SaveSegments';
import { formatTime, type Segment } from './segments';
import { useSaveSegments } from './useSaveSegments';
import styles from './MovieEdit.module.css';

/** One segment: its name and the way out of the list, then its two ends, each a way to go there. */
const SegmentRow: React.FC<{
    segment: Segment;
    selected: boolean;
    onSelect: () => void;
    onRename: (name: string) => void;
    onRemove: () => void;
    onGoToStart: () => void;
    onGoToEnd: () => void;
}> = ({ segment, selected, onSelect, onRename, onRemove, onGoToStart, onGoToEnd }) => {
    // Held while it is typed, so that a name on its way to being another is not written as each
    // of the names it passes through.
    const [name, setName] = useState(segment.name);
    useEffect(() => { setName(segment.name); }, [segment.name]);

    /** The name as it stands is written — or the box is put back, emptied or unchanged. */
    const commit = () => {
        const wanted = name.trim();
        if (!wanted || wanted === segment.name) {
            setName(segment.name);
            return;
        }
        onRename(wanted);
    };

    return (
        <div
            className={`${styles.row} ${selected ? styles.selected : ''}`}
            data-testid="segment-row"
            data-selected={selected || undefined}
            onClick={event => {
                // A click in the delete's confirmation arrives here through its portal, and a
                // segment on its way out is not one to make current.
                if (event.currentTarget.contains(event.target as Node)) onSelect();
            }}
        >
            <div className={styles.rowHead}>
                <Input
                    size="small"
                    className={styles.rowName}
                    value={name}
                    aria-label={`Name of ${segment.name}`}
                    data-testid="segment-name"
                    onChange={event => setName(event.target.value)}
                    onFocus={onSelect}
                    onBlur={commit}
                    onPressEnter={commit}
                />
                <Popconfirm
                    title="Delete this segment?"
                    description="Its name and its two ends go with it."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={onRemove}
                >
                    <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={`Delete ${segment.name}`}
                        data-testid="delete-segment"
                    />
                </Popconfirm>
            </div>
            <div className={styles.rowTimes}>
                <Tooltip title="Go to its first image">
                    <Button
                        size="small"
                        type="link"
                        className={styles.time}
                        onClick={onGoToStart}
                        aria-label={`Go to the start of ${segment.name}`}
                        data-testid="segment-start"
                    >
                        {formatTime(segment.startMs)}
                    </Button>
                </Tooltip>
                <span className={styles.dash}>–</span>
                <Tooltip title="Go to its last image">
                    <Button
                        size="small"
                        type="link"
                        className={styles.time}
                        onClick={onGoToEnd}
                        aria-label={`Go to the end of ${segment.name}`}
                        data-testid="segment-end"
                    >
                        {formatTime(segment.endMs)}
                    </Button>
                </Tooltip>
            </div>
        </div>
    );
};

/**
 * The segments of the open video, in the order they come in it.
 *
 * Added here, at the image on screen; made current by a click, which is what the banner's Start
 * and End then write into; renamed in place; gone to by either end; and thrown away. The list itself
 * is never saved by hand, as nothing in this CMS is: each change is a write to the
 * `<file>.config.json` sidecar beside the video, debounced — and a change made to that file
 * elsewhere is read back in.
 *
 * **Save** is something else: every segment cut out of the video as a file of its own beside it,
 * AV1 and Opus in Matroska, named after the segment — by ffmpeg, which is offered for install first
 * when the machine has none (see `useSaveSegments`).
 *
 * The tab is registered for every document, as every plugin's is, so with anything but a video
 * or a recording open it says what it is for instead.
 */
export const SegmentsPanel: React.FC = () => {
    const movie = useMovieEditOptional();
    if (!movie) {
        return <div className={styles.hint}>Open a video or a recording to mark segments of it.</div>;
    }
    return <SegmentsOf movie={movie} />;
};

/** The panel over an open video or recording, below the one early return its hooks cannot follow. */
const SegmentsOf: React.FC<{ movie: MovieEditValue }> = ({ movie }) => {
    const saving = useSaveSegments(movie);
    const { segments, selected, loading, invalid } = movie;
    const sidecar = extractName(movie.sidecarPath);

    return (
        <div className={styles.panel} data-testid="segments-panel">
            <div className={styles.header}>
                <Tooltip title="A new segment, starting and ending at the image on screen">
                    <Button
                        size="small"
                        icon={<PlusOutlined />}
                        disabled={loading || invalid}
                        onClick={movie.add}
                        data-testid="add-segment"
                    >
                        Add segment
                    </Button>
                </Tooltip>
                <SaveSegmentsButton saving={saving} />
            </div>
            <SaveSegmentsStatus saving={saving} />
            {loading ? (
                <div className={styles.center}><Spin size="small" /></div>
            ) : invalid ? (
                <div className={styles.hint} data-testid="segments-invalid">
                    <code>{sidecar}</code> does not read as segments, so it is left as it is. It opens as
                    JSON, to be mended by hand.
                </div>
            ) : segments.length === 0 ? (
                <div className={styles.hint}>
                    No segments yet. Add one where the video stands — they are kept in <code>{sidecar}</code>,
                    beside it.
                </div>
            ) : (
                <div className={`${styles.list} kiao-zebra-rows`}>
                    {segments.map(segment => (
                        <SegmentRow
                            key={segment.id}
                            segment={segment}
                            selected={segment.id === selected?.id}
                            onSelect={() => movie.select(segment.id)}
                            onRename={name => movie.rename(segment.id, name)}
                            onRemove={() => movie.remove(segment.id)}
                            onGoToStart={() => movie.goToStart(segment.id)}
                            onGoToEnd={() => movie.goToEnd(segment.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};
