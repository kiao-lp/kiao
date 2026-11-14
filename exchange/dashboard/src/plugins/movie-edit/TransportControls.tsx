import React from 'react';
import { Button, Flex } from 'antd';
import {
    CaretRightOutlined, FastBackwardOutlined, FastForwardOutlined, PauseOutlined, ScissorOutlined,
    StepBackwardOutlined, StepForwardOutlined,
} from '@ant-design/icons';
import { useToolBars, Tooltip } from '@kiao-dashboard-core';
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

/** The transport, in the banner as every document's controls are: the play button between the steps —. */
export const TransportControls: React.FC = () => {
    const movie = useMovieEdit();
    const { showTab } = useToolBars();
    const { audio, can, paused, selected } = movie;
    const canMark = !!selected && !movie.loading && !movie.invalid;

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
                <Button
                    size="small"
                    icon={<StepBackwardOutlined />}
                    disabled={!can.previousImage}
                    onClick={() => movie.stepImage(-1)}
                    aria-label="Previous image"
                />
            </>}
            <Button
                size="small"
                icon={paused ? <CaretRightOutlined /> : <PauseOutlined />}
                onClick={movie.togglePlay}
                aria-label={paused ? 'Play' : 'Pause'}
            />
            {!audio && <>
                <Button
                    size="small"
                    icon={<StepForwardOutlined />}
                    disabled={!can.nextImage}
                    onClick={() => movie.stepImage(1)}
                    aria-label="Next image"
                />
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
            <span aria-label="Playback position"
                className={`${styles.time} ${styles.readout}`}
                data-testid="movie-time"
            >
                {formatTime(movie.time * 1000)}
            </span>
            <div className={styles.separator} />
            <Button
                size="small"
                disabled={!canMark}
                onClick={movie.setStart}
                aria-label="Set start"
            >
                Start
            </Button>
            <Button
                size="small"
                disabled={!canMark}
                onClick={movie.setEnd}
                aria-label="Set end"
            >
                End
            </Button>
            <Tooltip title="Start and End update this segment. Click to open the Segments panel.">
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
