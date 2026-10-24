import React from 'react';
import { Layout, Flex, type MenuProps } from 'antd';
import { LanguageSwitch } from './LanguageSwitch';
import { CompanionSwitch } from './CompanionSwitch';
import { ToolsDropdown } from './ToolsDropdown';
import { BarToggle } from './BarToggle';
import { FileSearchInput } from '../files/browser/FileSearchInput';
import { useFileSearchContext } from '../files/core/FileSearch-ctx';
import { ZoomSlider } from '../zoom';
import { useEmbeddedDocument } from '../core/EmbeddedDocument-ctx';

const { Footer } = Layout;

export type TopBannerProps = {
    /** Extra items to prepend to the Tools dropdown menu, contributed by the active plugin. */
    additionalToolsItems?: MenuProps['items'];
};

export const TopBanner: React.FC<TopBannerProps> = ({ additionalToolsItems }) => {
    const embedded = useEmbeddedDocument();
    const { search, clearSearch, searchError, searchResults } = useFileSearchContext();
    if (embedded) return null;

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
                            onSearch={search}
                            onClear={clearSearch}
                            error={searchError}
                            showingResults={searchResults !== null}
                        />
                    </div>
                </Flex>

                <Flex align="center" gap="small" style={{ flexShrink: 0 }}>
                    {/* Nothing while nothing is selected — see cms-core/zoom. */}
                    <ZoomSlider />
                    <CompanionSwitch />
                    <LanguageSwitch />
                    <ToolsDropdown extraItems={additionalToolsItems} />
                    <BarToggle side="right" />
                </Flex>
            </Flex>
        </Footer>
    );
};

