import React from 'react';
import { Layout, Flex, Grid, MenuProps } from 'antd';
import { useCommandDispatcherContext } from '../commands/CommandDispatcher-ctx';
import { CommandSentence } from './CommandSentence';
import { LanguageSwitch } from './LanguageSwitch';
import { CompanionSwitch } from './CompanionSwitch';
import { ToolsDropdown } from './ToolsDropdown';
import { BarToggle } from './BarToggle';
import { FileSearchInput } from '../files/browser/FileSearchInput';
import { useFileSearchContext } from '../files/core/FileSearch-ctx';
import { ZoomSlider } from '../zoom';

const { Footer } = Layout;
const { useBreakpoint } = Grid;

export type TopBannerProps = {
    additionalPanels?: React.ReactNode;
    /** Extra items to prepend to the Tools dropdown menu, contributed by the active plugin. */
    additionalToolsItems?: MenuProps['items'];
};

export const TopBanner: React.FC<TopBannerProps> = ({ additionalPanels, additionalToolsItems }) => {
    const { enabled: commandDispatcherOn } = useCommandDispatcherContext();
    const { search, clearSearch, searchError, searchResults } = useFileSearchContext();
    const screens = useBreakpoint();
    const isSmallScreen = !screens.md;

    // No navigation: the results open as a panel on the central area's stack, over whatever is
    // showing — a document, a folder, a board — and closing them is back on that.
    const handleSearch = (query: string) => {
        search(query);
    };

    const handleClear = () => {
        clearSearch();
    };

    return (
        <Footer className="cms-top-banner">
            <Flex gap="small" align="center" justify="space-between" style={{ width: '100%' }}>
                {/* The two columns, switched on and off from the end of the banner each sits at. */}
                <div style={{ flexShrink: 0 }}>
                    <BarToggle side="left" />
                </div>

                <Flex align="center" gap="small" style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, maxWidth: 320 }}>
                        <FileSearchInput
                            onSearch={handleSearch}
                            onClear={handleClear}
                            error={searchError}
                            showingResults={searchResults !== null}
                        />
                    </div>
                    {!isSmallScreen && commandDispatcherOn && (
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                            <CommandSentence />
                        </div>
                    )}
                </Flex>

                <Flex align="center" gap="small" style={{ flexShrink: 0 }}>
                    {/* Nothing while nothing is selected — see cms-core/zoom. */}
                    <ZoomSlider />
                    {additionalPanels}
                    <CompanionSwitch />
                    <LanguageSwitch />
                    <ToolsDropdown extraItems={additionalToolsItems} />
                    <BarToggle side="right" />
                </Flex>
            </Flex>
        </Footer>
    );
}

