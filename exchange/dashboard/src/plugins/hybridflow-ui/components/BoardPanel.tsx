import React from 'react';
import { CentralStackProvider, CentralStackView, lazyComponent } from '@cms-core';
import { useHybridflow } from '../Hybridflow-ctx';
import styles from './BoardPanel.module.css';

const Board = lazyComponent(() => import('./Board').then(m => ({ default: m.Board })));
const BoardsPage = lazyComponent(() => import('./BoardsPage').then(m => ({ default: m.BoardsPage })));
const ExpandedFlowNode = lazyComponent(() => import('./ExpandedFlowNode').then(m => ({ default: m.ExpandedFlowNode })));

export const BoardPanel: React.FC = () => {
    const { handle } = useHybridflow();
    return <CentralStackProvider>
        <div className={styles.area} data-testid="board-panel">
            {handle ? <>
                <Board handle={handle} />
                <ExpandedFlowNode />
            </> : <BoardsPage />}
            <CentralStackView />
        </div>
    </CentralStackProvider>;
};
