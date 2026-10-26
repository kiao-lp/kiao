import React, { useLayoutEffect, useRef } from 'react';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { WorkerClientMockProvider } from 'kiao-worker';
import { ConfiguredMarkdown } from './index';

it('renders a plain label before its canvas measures it', () => {
    const measure = vi.fn();
    const Note = () => {
        const element = useRef<HTMLDivElement>(null);
        useLayoutEffect(() => { measure(element.current?.textContent); }, []);
        return <div ref={element}><ConfiguredMarkdown>Note A</ConfiguredMarkdown></div>;
    };

    render(<WorkerClientMockProvider mock={{ workerClient: {} as any }}><Note /></WorkerClientMockProvider>);
    expect(measure).toHaveBeenCalledWith('Note A');
});
