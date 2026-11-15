import React from 'react';
import { lazyComponent } from '@kiao-dashboard-core';
import { useHybridflow } from '../Hybridflow-ctx';
import styles from './BoardPanel.module.css';

const Board = lazyComponent(() => import('./Board').then(m => ({ default: m.Board })));
const BoardsPage = lazyComponent(() => import('./BoardsPage').then(m => ({ default: m.BoardsPage })));
const WorkOnTaskHost = lazyComponent(() => import('./WorkOnTask').then(m => ({ default: m.WorkOnTaskHost })));

export const BoardPanel: React.FC = () => {
    const { handle } = useHybridflow();
    return <div className={styles.area} data-testid="board-panel">
        {handle ? <>
            <Board handle={handle} />
            <WorkOnTaskHost />
        </> : <BoardsPage />}
    </div>;
};
