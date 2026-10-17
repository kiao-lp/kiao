import React from 'react';
import { getArchDiaStyleString } from '../lib/archdia-styles';
import { ArchDiaTheme } from '../lib/archdia-theme';

export interface ArchDiaStyleProps {
    /**
     * Optional theme overrides to set as default values for the CSS variables.
     */
    themeVars?: Partial<ArchDiaTheme>;
}

/**
 * A component that injects the centralized ArchDia styles into a <style> tag.
 * Drop this anywhere in your React tree to provide the styles required for rendering
 * ArchDia components.
 */
export const ArchDiaStyle: React.FC<ArchDiaStyleProps> = ({ themeVars }) => {
    const cssString = getArchDiaStyleString(themeVars);

    return (
        <style dangerouslySetInnerHTML={{ __html: cssString }} />
    );
};
