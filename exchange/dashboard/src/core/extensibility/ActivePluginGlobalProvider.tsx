import React from 'react';

import { useActivePluginContext } from './ActivePlugin';

export const ActivePluginGlobalProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
    const { activeFileConfig } = useActivePluginContext();

    const withGlobalProvider = activeFileConfig?.withGlobalProvider;

    if (withGlobalProvider) {
        return (<>{withGlobalProvider(children)}</>);
    } else {
        return (<>{children}</>);
    }
};
