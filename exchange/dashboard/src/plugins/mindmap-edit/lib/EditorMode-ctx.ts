import { createStateContext } from 'react-concise';

// We can define a generic minimal set of modes, or allow extensions.
// For now, most plugins will have at least visualizing and editing.
export type BaseEditorMode = 'VISUALIZE' | 'EDIT';

export function createEditorModeContext<T extends string = BaseEditorMode>(defaultMode: T) {
    const context = createStateContext<T>('editor mode', defaultMode);

    const useEditorMode = (): [T, (mode: T) => void] => {
        const [mode, setMode] = context.useContext();
        return [mode, setMode];
    };

    return {
        Provider: context.Provider,
        useEditorMode
    };
}
