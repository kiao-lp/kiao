import React from 'react';
import { useFileBrowsingPersistenceContext } from '../../files/core/FileBrowsingPersistence-ctx';
import { useActivePluginContext } from '../../extensibility/ActivePlugin';
import { TopBanner } from '../top-banner/TopBanner';
import { LayoutContent } from '../layout/LayoutContent';

export const ActivePluginMainViewCmp: React.FC<{}> = () => {
    const { activeFileConfig } = useActivePluginContext();
    const { currentFile } = useFileBrowsingPersistenceContext();
    return <>
        {currentFile && activeFileConfig ? (<>
            <activeFileConfig.mainView />
        </>) : (<><LayoutContent>
            No file or not supported
        </LayoutContent>
            <TopBanner /></>)}
    </>;
};

