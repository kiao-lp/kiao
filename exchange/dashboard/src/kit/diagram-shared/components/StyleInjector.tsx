import React from 'react';

export interface StyleInjectorProps {
    /** The CSS string to inject. */
    css: string;
}

/**
 * Injects a CSS string into a <style> tag.
 */
export const StyleInjector: React.FC<StyleInjectorProps> = ({ css }) => (
    <style dangerouslySetInnerHTML={{ __html: css }} />
);
