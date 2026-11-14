import React from 'react';
import { BoardsListProvider } from '../BoardsList-ctx';
import { BoardsList } from './BoardsList';
import { BoardsControls } from './BoardsControls';
import styles from './BoardsList.module.css';

/** The full boards list shown in the Board panel at `/boards`. */
export const BoardsPage: React.FC = () => (
    <BoardsListProvider>
        <BoardsList header={<div className={styles.header}><BoardsControls /></div>} />
    </BoardsListProvider>
);
