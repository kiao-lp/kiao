import { createStateContext } from 'react-concise';

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
