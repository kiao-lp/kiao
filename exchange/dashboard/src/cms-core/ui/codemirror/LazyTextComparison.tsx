import React, { forwardRef, lazy, Suspense } from 'react';
import { ErrorBoundary } from '../../markdown/components/ErrorBoundary';
import type { TextComparisonHandle, TextComparisonProps } from './TextComparison';

const Component = lazy(() => import('./TextComparison').then(module => ({ default: module.TextComparison })));

export const TextComparison = forwardRef<TextComparisonHandle, TextComparisonProps>((props, ref) => (
    <ErrorBoundary>
        <Suspense fallback={<div role="status">Loading…</div>}>
            <Component {...props} ref={ref} />
        </Suspense>
    </ErrorBoundary>
));

TextComparison.displayName = 'LazyTextComparison';
