import React from 'react';

export interface StyleInjectorProps {
    css: string;
}

export const StyleInjector: React.FC<StyleInjectorProps> = ({ css }) => (
    <style dangerouslySetInnerHTML={{ __html: css }} />
);
