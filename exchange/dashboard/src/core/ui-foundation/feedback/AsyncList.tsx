import type { ReactNode } from 'react';
import { Alert, Button } from 'antd';
import { InProgressFeedback } from './InProgressFeedback';
import styles from './AsyncList.module.css';

interface AsyncListProps {
    loading?: boolean;
    loadingLabel?: string;
    error?: ReactNode;
    errorTitle?: string;
    onRetry?: () => void;
    retrying?: boolean;
    empty?: ReactNode;
    children?: ReactNode;
}

const retryLabel = 'Try again';

/** A list's blocking feedback. Callers decide when existing rows can stay visible. */
export function AsyncList({
    loading, loadingLabel = 'Loading', error, errorTitle, onRetry, retrying, empty, children,
}: AsyncListProps) {
    if (error) {
        return <Alert
            className={styles.error}
            type="error"
            showIcon
            title={errorTitle ?? error}
            description={errorTitle ? error : undefined}
            action={onRetry && <Button size="small" loading={retrying} disabled={retrying}
                aria-label={retryLabel} aria-busy={retrying} onClick={onRetry}>{retryLabel}</Button>}
        />;
    }
    if (loading) {
        return <div className={styles.status}>
            <InProgressFeedback label={`${loadingLabel}…`} aria-label={loadingLabel} />
        </div>;
    }
    if (empty) return <div className={styles.status} role="status">{empty}</div>;
    return <>{children}</>;
}
