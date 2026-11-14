import React from 'react';
import { BoardsListProvider } from '../BoardsList-ctx';
import { BoardsList } from './BoardsList';
import { BoardsControls } from './BoardsControls';
import styles from './BoardsList.module.css';

export const BoardsPanel: React.FC = () => (
    <BoardsListProvider>
        <BoardsList
            compact
            header={(
                <div className={styles.header}>
                    <span className={styles.spacer} />
                    <BoardsControls />
                </div>
            )}
        />
    </BoardsListProvider>
);
