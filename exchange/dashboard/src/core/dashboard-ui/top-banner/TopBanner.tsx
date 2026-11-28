import React from 'react';
import { Layout, Flex, type MenuProps } from 'antd';
import { LanguageSwitch } from './LanguageSwitch';
import { CompanionSwitch } from './CompanionSwitch';
import { ToolsDropdown } from './ToolsDropdown';
import { BarToggle, SecondCentralAreaToggle } from './BarToggle';
import { FileSearchInput } from '../../files/browser/FileSearchInput';
import { useFileSearchContext } from '../../files/core/FileSearch-ctx';
import { ZoomSlider } from '../../ui-foundation/zoom';
import { useEmbeddedDocument } from '../documents/EmbeddedDocument-ctx';
import './TopBanner.css';

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
        <Footer className="cms-top-banner" data-zoom-controls>
            <ToolsDropdown extraItems={additionalToolsItems} />
            <div className="cms-top-banner-search">
                <FileSearchInput
                    onSearch={search}
                    onClear={clearSearch}
                    error={searchError}
                    showingResults={searchResults !== null}
                />
            </div>

            <Flex className="cms-top-banner-controls" align="center" justify="end" wrap="wrap" gap="small">
                <ZoomSlider />
                <CompanionSwitch />
                <LanguageSwitch />
                <Flex align="center" gap={2} role="group" aria-label="Layout visibility">
                    <BarToggle bar="left" />
                    <SecondCentralAreaToggle />
                    <BarToggle bar="right" />
                </Flex>
            </Flex>
        </Footer>
    );
};

