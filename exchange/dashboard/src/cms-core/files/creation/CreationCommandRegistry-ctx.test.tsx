import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDto } from 'src/cms-core/files/service';

const h = vi.hoisted(() => ({
    browsing: { currentPath: 'units', currentFile: null as FileDto | null },
}));

vi.mock('../core/FileBrowsingPersistence-ctx', () => ({
    useFileBrowsingPersistenceContext: () => h.browsing,
}));

import { CreationCommandRegistryProvider, useCreationCommandRegistry, useCreationCommands } from './CreationCommandRegistry-ctx';

const executed: string[] = [];

/** Runs every bound command and reports the folder each one was given. */
const CommandsProbe: React.FC<{ targetPath?: string }> = ({ targetPath }) => {
    const registry = useCreationCommandRegistry();
    React.useEffect(() => registry.register('probe', [{
        id: 'new-thing',
        label: 'Thing',
        icon: null,
        execute: ctx => { executed.push(ctx.currentPath); },
    }]), [registry]);

    const commands = useCreationCommands(targetPath);

    return (
        <>
            {commands.map(cmd => (
                <button key={cmd.id} data-testid={`run-${cmd.id}`} onClick={() => cmd.execute()}>
                    {cmd.label}
                </button>
            ))}
        </>
    );
};

const renderProbe = (targetPath?: string) => render(
    <CreationCommandRegistryProvider>
        <CommandsProbe targetPath={targetPath} />
    </CreationCommandRegistryProvider>,
);

describe('useCreationCommands', () => {
    beforeEach(() => {
        executed.length = 0;
    });

    it('creates in the browsed folder when no target is given', () => {
        renderProbe();

        fireEvent.click(screen.getByTestId('run-new-thing'));

        expect(executed).toEqual(['units']);
    });

    it('creates in the given target folder instead of the browsed one', () => {
        renderProbe('units/greetings');

        fireEvent.click(screen.getByTestId('run-new-thing'));

        expect(executed).toEqual(['units/greetings']);
    });

    it('takes the store root as a target rather than falling back to the browsed folder', () => {
        renderProbe('');

        fireEvent.click(screen.getByTestId('run-new-thing'));

        expect(executed).toEqual(['']);
    });
});
