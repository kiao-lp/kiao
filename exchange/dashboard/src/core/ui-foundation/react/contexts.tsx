import React, { createContext, useContext, useState, ReactNode } from 'react';

export function createSynchronizedStateContext<T>(
    useSyncCallback: () => () => Promise<T> | T,
    defaultValue: T,
    interval?: number
) {
    const Context = createContext<T>(defaultValue);

    const Provider: React.FC<{ children: ReactNode }> = ({ children }) => {
        const [state, setState] = useState<T>(defaultValue);
        const getSync = useSyncCallback();

        React.useEffect(() => {
            let mounted = true;
            let timeoutId: any;

            const loop = async () => {
                try {
                    const val = await getSync();
                    if (mounted) setState(val);
                } catch (e) {
                    // ignore errors
                }
                if (mounted && interval) {
                    timeoutId = setTimeout(loop, interval);
                }
            }
            loop();
            return () => {
                mounted = false;
                clearTimeout(timeoutId);
            }
        }, [getSync]);

        return <Context.Provider value={state}>{children}</Context.Provider>;
    };

    return {
        Provider,
        useContext: () => useContext(Context),
        Context
    };
}


export const useRenderAgain = () => {
    const [, setTick] = useState(0);
    return () => setTick(tick => tick + 1);
};

export function createSimpleContext<TProps, TValue>(
    useValueHook: (props: TProps) => TValue,
    defaultValue: TValue
) {
    const Context = createContext<TValue>(defaultValue);

    const Provider = (props: TProps & { children: ReactNode }) => {
        // @ts-ignore
        const { children, ...rest } = props;
        const value = useValueHook(rest as TProps);
        return <Context.Provider value={value}>{children}</Context.Provider>;
    };

    return {
        Provider,
        useContext: () => useContext(Context),
        Context
    };
}

export function createStateContext<T>(name: string, defaultValue: T) {
    type ContextType = [T, React.Dispatch<React.SetStateAction<T>>];
    const Context = createContext<ContextType>([defaultValue, () => { }]);

    const Provider: React.FC<{ children: ReactNode }> = ({ children }) => {
        const [state, setState] = useState<T>(defaultValue);
        return <Context.Provider value={[state, setState]}>{children}</Context.Provider>;
    };

    return {
        Provider,
        useContext: () => useContext(Context),
        Context
    };
}
