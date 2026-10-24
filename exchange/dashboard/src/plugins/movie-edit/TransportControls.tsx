import React from 'react';
import { Button, Flex } from 'antd';
import {
    CaretRightOutlined, FastBackwardOutlined, FastForwardOutlined, PauseOutlined, ScissorOutlined,
    StepBackwardOutlined, StepForwardOutlined,
} from '@ant-design/icons';
import { useToolBars, Tooltip } from '@cms-core';
import { SEGMENTS_TAB_ID } from './constants';
import { useMovieEdit, type MovieEditValue } from './MovieEdit-ctx';
import { formatTime } from './segments';
import styles from './MovieEdit.module.css';

/** What a key-image button says, which a disabled one has to say for itself. */
const keyTitle = (movie: MovieEditValue, label: string): string => {
    if (movie.timelineStatus === 'loading') return `${label} — reading where the key images are…`;
    if (!movie.hasKeys) return `${label} — this file does not list its key images`;
    return label;
};

/**
 * The transport, in the banner as every document's controls are: the play button between the
 * steps — a key image back, an image back, an image forward, a key image forward — the time of the
 * image on screen, and the two buttons that save it as an end of the current segment.
 *
 * A recording has no images, so it gets the play button, the time and the two ends. The last
 * button names the current segment and brings the segments panel up, since that is where one is
 * chosen, and a banner saying what Start and End will write into spares a look at the panel.
 */
export const TransportControls: React.FC = () => {
    const movie = useMovieEdit();
    const { showTab } = useToolBars();
    const { audio, can, paused, selected } = movie;
    const canMark = !!selected && !movie.loading && !movie.invalid;
    const markHint = canMark ? '' : ' — select a segment first';

    return (
        <Flex align="center" gap={4} className={`movie-edit-controls ${styles.controls}`}>
            {!audio && <>
                <Tooltip title={keyTitle(movie, 'Previous key image (Shift+←)')}>
                    <Button
                        size="small"
                        icon={<FastBackwardOutlined />}
                        disabled={!can.previousKey}
                        onClick={() => movie.stepKeyImage(-1)}
                        aria-label="Previous key image"
                    />
                </Tooltip>
                <Tooltip title="Previous image (←)">
                    <Button
                        size="small"
                        icon={<StepBackwardOutlined />}
                        disabled={!can.previousImage}
                        onClick={() => movie.stepImage(-1)}
                        aria-label="Previous image"
                    />
                </Tooltip>
            </>}
            <Tooltip title={paused ? 'Play' : 'Pause'}>
                <Button
                    size="small"
                    icon={paused ? <CaretRightOutlined /> : <PauseOutlined />}
                    onClick={movie.togglePlay}
                    aria-label={paused ? 'Play' : 'Pause'}
                />
            </Tooltip>
            {!audio && <>
                <Tooltip title="Next image (→)">
                    <Button
                        size="small"
                        icon={<StepForwardOutlined />}
                        disabled={!can.nextImage}
                        onClick={() => movie.stepImage(1)}
                        aria-label="Next image"
                    />
                </Tooltip>
                <Tooltip title={keyTitle(movie, 'Next key image (Shift+→)')}>
                    <Button
                        size="small"
                        icon={<FastForwardOutlined />}
                        disabled={!can.nextKey}
                        onClick={() => movie.stepKeyImage(1)}
                        aria-label="Next key image"
                    />
                </Tooltip>
            </>}
            <Tooltip title={audio ? 'Where the recording is' : 'When the image on screen starts'}>
                <span
                    className={`${styles.time} ${styles.readout}`}
                    data-testid="movie-time"
                >
                    {formatTime(movie.time * 1000)}
                </span>
            </Tooltip>
            <div className={styles.separator} />
            <Tooltip title={`Save this position as the segment's start${markHint}`}>
                <Button
                    size="small"
                    disabled={!canMark}
                    onClick={movie.setStart}
                    aria-label="Set start"
                >
                    Start
                </Button>
            </Tooltip>
            <Tooltip title={`Save this position as the segment's end${markHint}`}>
                <Button
                    size="small"
                    disabled={!canMark}
                    onClick={movie.setEnd}
                    aria-label="Set end"
                >
                    End
                </Button>
            </Tooltip>
            <Tooltip title="The segment Start and End are saved into — they are all in the Segments panel">
                <Button
                    size="small"
                    type="text"
                    icon={<ScissorOutlined />}
                    className={styles.current}
                    onClick={() => showTab(SEGMENTS_TAB_ID)}
                    data-testid="movie-segment"
                >
                    {selected ? selected.name || 'Unnamed segment' : 'No segment'}
                </Button>
            </Tooltip>
        </Flex>
    );
};
