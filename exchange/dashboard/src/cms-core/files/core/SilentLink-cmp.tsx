import React from 'react';
import { useNavigation } from '../navigation/NavigationModel';

export interface SilentLinkProps extends React.HTMLAttributes<HTMLDivElement> {
    to: string;
}

export const SilentLink: React.FC<SilentLinkProps> = ({ to, children, onClick, onAuxClick, style, ...props }) => {
    const nav = useNavigation();

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (onClick) {
            onClick(e);
            if (e.defaultPrevented) return;
        }

        if (e.ctrlKey || e.metaKey) {
            nav.openInNewTab(to);
        } else if (e.shiftKey) {
            nav.openInNewWindow(to);
        } else {
            nav.open(to);
        }
    };

    const handleAuxClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (onAuxClick) {
            onAuxClick(e);
            if (e.defaultPrevented) return;
        }

        if (e.button === 1) {
            e.preventDefault();
            nav.openInNewTab(to);
        }
    };

    return (
        <div
            {...props}
            onClick={handleClick}
            onAuxClick={handleAuxClick}
            style={{ cursor: 'pointer', ...style }}
            role="link"
        >
            {children}
        </div>
    );
};
