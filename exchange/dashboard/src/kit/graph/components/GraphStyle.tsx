import React from 'react';
import { DiagramTheme, StyleInjector } from '@cms-kit/diagram-shared';
import { getGraphStyleString } from '../lib/graph-styles';

export interface GraphStyleProps {
    themeVars?: Partial<DiagramTheme>;
}

/**
 * Injects the graph CSS styles into a <style> tag.
 */
export const GraphStyle: React.FC<GraphStyleProps> = ({ themeVars }) => (
    <StyleInjector css={getGraphStyleString(themeVars)} />
);
