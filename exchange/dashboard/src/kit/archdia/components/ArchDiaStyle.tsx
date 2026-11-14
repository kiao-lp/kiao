import React from 'react';
import { getArchDiaStyleString } from '../lib/archdia-styles';
import { ArchDiaTheme } from '../lib/archdia-theme';

export interface ArchDiaStyleProps {
    themeVars?: Partial<ArchDiaTheme>;
}

export const ArchDiaStyle: React.FC<ArchDiaStyleProps> = ({ themeVars }) => {
    const cssString = getArchDiaStyleString(themeVars);

    return (
        <style dangerouslySetInnerHTML={{ __html: cssString }} />
    );
};
