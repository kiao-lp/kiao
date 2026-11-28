import React from 'react';
import { Button } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { AsyncList, CommitInput, IconButton, extractName, Tooltip, useConfirmation } from '@kiao-dashboard-core';
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
    const confirm = useConfirmation();

    return (
        <div
            className={`${styles.row} ${selected ? styles.selected : ''}`}
            data-testid="segment-row"
            data-selected={selected || undefined}
            onClick={event => {
                if (event.currentTarget.contains(event.target as Node)) onSelect();
            }}
        >
            <div className={styles.rowHead}>
                <CommitInput
                    className={styles.rowName}
                    value={segment.name}
                    aria-label={`Name of ${segment.name}`}
                    data-testid="segment-name"
                    onFocus={onSelect}
                    onCommit={value => {
                        const name = value.trim();
                        if (name && name !== segment.name) onRename(name);
                    }}
                />
                <IconButton
                    label={`Delete ${segment.name}`}
                    danger
                    icon={<DeleteOutlined />}
                    data-testid="delete-segment"
                    onClick={() => confirm({
                        title: `Delete segment “${segment.name}”?`,
                        description: 'Its name and its two ends go with it.',
                        onConfirm: onRemove,
                    })}
                />
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

/** The segments of the open video, in the order they come in it. */
export const SegmentsPanel: React.FC = () => {
    const movie = useMovieEditOptional();
    if (!movie) {
        return <div className={styles.hint}>Open a video or a recording to mark segments of it.</div>;
    }
    return <SegmentsOf key={movie.path} movie={movie} />;
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
            <AsyncList loading={loading}
                error={!loading && invalid && <span data-testid="segments-invalid">
                    <code>{sidecar}</code> does not read as segments, so it is left as it is. It opens as
                    JSON, to be mended by hand.
                </span>}
                empty={!segments.length && <>
                    No segments yet. Add one where the video stands — they are kept in <code>{sidecar}</code>,
                    beside it.
                </>}>
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
            </AsyncList>
        </div>
    );
};
