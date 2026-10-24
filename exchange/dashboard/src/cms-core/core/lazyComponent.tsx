import React, { lazy, Suspense } from 'react';
import { ErrorBoundary } from '../markdown/components/ErrorBoundary';

/** Defer an interface without suspending its providers or the neighbouring panels. Declare once at module scope. */
export const lazyComponent = <T extends React.FC<any>>(load: () => Promise<{ default: T }>): React.FC<React.ComponentProps<T>> => {
    const Component = lazy(load) as React.FC<React.ComponentProps<T>>;
    return props => (
        <ErrorBoundary>
            <Suspense fallback={<div role="status">Loading…</div>}>
                <Component {...props} />
            </Suspense>
        </ErrorBoundary>
    );
};
