import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
    listFiles: vi.fn<(path: string) => Promise<unknown[]>>(),
    getFileJson: vi.fn<(path: string) => Promise<unknown>>(),
}));

/**
 * The `file` field: a template variable answered by dragging a file of the store onto it.
 *
 * The drop itself is `useFileDrop`, the real one — the box under test is the wiring between that
 * and the heap, and a mocked drop would leave exactly the wiring untested. The rest of `@cms-core`
 * is stubbed because none of it is reached: the whole public API imported into jsdom for the sake
 * of one hook is a slow way of testing nothing.
 *
 * `useWorkerClient` answers the hoisted client, which only the config-values tests drive — a
 * store's value providers, loaded through the real provider.
 */
vi.mock('@cms-core', async () => {
    const dnd = await vi.importActual<typeof import('../../cms-core/files/dnd/useFileDrop')>(
        '../../cms-core/files/dnd/useFileDrop',
    );
    return {
        useFileDrop: dnd.useFileDrop,
        extractName: (path: string) => path.slice(path.lastIndexOf('/') + 1),
        // Only the `text` type draws it, and no test here asks for one.
        VoiceTextArea: () => null,
        useWorkerClient: () => client,
    };
});

import { KiaoElHeap } from '@cms-kit/template-lang';
import { writeDraggedFiles } from '../../cms-core/files/dnd/dragPaths';
import { ConfigValuesProvider } from './ConfigValues-ctx';
import { HeapContext, ValueField } from './ValueField';

/** jsdom has no `DataTransfer`; what both ends of a drag use is a bag of types. */
const dragOf = (path: string, isDirectory = false): DataTransfer => {
    const store: Record<string, string> = {};
    const data = {
        get types() { return Object.keys(store); },
        setData: (type: string, value: string) => { store[type] = value; },
        getData: (type: string) => store[type] ?? '',
        effectAllowed: 'none',
        dropEffect: 'none',
    } as unknown as DataTransfer;
    writeDraggedFiles(data, [{ path, isDirectory }]);
    return data;
};

/** The field, over a heap the test can read back — which is where the answer actually lands. */
const fieldOf = (expression: string) => {
    const heap: { current: KiaoElHeap } = { current: {} };
    const Harness: React.FC = () => {
        const state = React.useState<KiaoElHeap>({});
        heap.current = state[0];
        return (
            <HeapContext.Provider value={state}>
                <ValueField kbElExpr={expression} />
            </HeapContext.Provider>
        );
    };
    render(<Harness />);
    return heap;
};

const box = (key = 'doc') => screen.getByTestId(`template-file-${key}`);

describe('a template variable typed file', () => {
    it('is a text box, filled by dropping a file of the store on it', () => {
        const heap = fieldOf('doc:file');

        fireEvent.drop(box(), { dataTransfer: dragOf('units/abc/cadre.md') });

        // The path as a document of the store names it: from the root, with a leading slash.
        expect(box()).toHaveValue('/units/abc/cadre.md');
        expect(heap.current.doc.value).toBe('/units/abc/cadre.md');
    });

    // One dropped file answers both expressions: `collectRenderNodes` draws a single box for the
    // key, and the object under it holds what each of them reads.
    it('leaves the dropped file’s name where ${doc:file.name} reads it', () => {
        const heap = fieldOf('doc:file');

        fireEvent.drop(box(), { dataTransfer: dragOf('units/abc/cadre.md') });

        expect(heap.current.doc.name).toBe('cadre.md');
    });

    it('draws the name itself when that is what the expression asked for', () => {
        fieldOf('doc:file.name');

        fireEvent.drop(box(), { dataTransfer: dragOf('units/abc/cadre.md') });

        expect(box()).toHaveValue('cadre.md');
    });

    // A variable asking for something of the store is not the place to decide a folder was a
    // mistake — it goes in as its own path.
    it('takes a dropped folder as itself', () => {
        const heap = fieldOf('doc:file');

        fireEvent.drop(box(), { dataTransfer: dragOf('units/abc', true) });

        expect(heap.current.doc.value).toBe('/units/abc');
    });

    it('is still an ordinary text box, typed into by hand', () => {
        const heap = fieldOf('doc:file');

        fireEvent.change(box(), { target: { value: '/notes/today.md' } });

        expect(heap.current.doc.value).toBe('/notes/today.md');
    });
});

describe('a template variable answered from grouped config values', () => {
    const KAFKA = {
        type: 'TopicToLearn',
        value: 'Apache Kafka',
        object: { folderName: 'Apache Kafka', objective: 'use it in architecture reviews' },
    };

    beforeEach(() => {
        client.listFiles.mockResolvedValue([
            { path: 'kiao-user-config/values/topics.json', isDirectory: false },
        ]);
        client.getFileJson.mockResolvedValue([KAFKA]);
    });

    /** The field, over a heap the test can read back, with the providers loaded for real. */
    const fieldWithProviders = (expression: string) => {
        const heap: { current: KiaoElHeap } = { current: {} };
        const Harness: React.FC = () => {
            const state = React.useState<KiaoElHeap>({});
            heap.current = state[0];
            return (
                <ConfigValuesProvider>
                    <HeapContext.Provider value={state}>
                        <ValueField kbElExpr={expression} />
                    </HeapContext.Provider>
                </ConfigValuesProvider>
            );
        };
        const view = render(<Harness />);
        return { heap, view };
    };

    it('matches on a grouped field and brings the whole object into the heap', async () => {
        const { heap, view } = fieldWithProviders('topic:TopicToLearn.objective');
        await waitFor(() => expect(client.getFileJson).toHaveBeenCalled());

        const box = view.container.querySelector('input');
        fireEvent.change(box!, { target: { value: KAFKA.object.objective } });

        expect(heap.current.topic).toEqual(KAFKA);
        expect(heap.current.topic.object).not.toBe(KAFKA.object);
    });

    // One answer fills every box that names its key: a second box asking for another field of
    // the same answer reads it out of the heap, through the placeholder it always named.
    it('reads a second field of the same answer where its placeholder names it', async () => {
        const heap: { current: KiaoElHeap } = { current: {} };
        const Harness: React.FC = () => {
            const state = React.useState<KiaoElHeap>({});
            heap.current = state[0];
            return (
                <ConfigValuesProvider>
                    <HeapContext.Provider value={state}>
                        <ValueField kbElExpr="topic:TopicToLearn.objective" />
                        <ValueField kbElExpr="topic:TopicToLearn.folderName" />
                    </HeapContext.Provider>
                </ConfigValuesProvider>
            );
        };
        const view = render(<Harness />);
        await waitFor(() => expect(client.getFileJson).toHaveBeenCalled());

        const boxes = view.container.querySelectorAll('input');
        fireEvent.change(boxes[0], { target: { value: KAFKA.object.objective } });

        expect(boxes[1]).toHaveValue(KAFKA.object.folderName);
    });
});
