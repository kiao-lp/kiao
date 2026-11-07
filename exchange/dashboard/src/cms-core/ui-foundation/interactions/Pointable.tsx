import React from 'react';
import classNames from 'classnames';

import { useAutoUnpointOnDestroy, usePointedElementApi } from './PointedElementContext';

export interface PointableProps {
    id: string;
    disabled?: boolean;
    children?: React.ReactNode;
}

export const Pointable: React.FC<PointableProps> = ({ children, id, disabled = false }) => {
    const { pointed, point, unPoint } = usePointedElementApi(id);

    useAutoUnpointOnDestroy(id);

    if (disabled) {
        return <>{children}</>;
    } else {
        return <div onMouseEnter={point} onMouseLeave={unPoint} className={classNames({ pointed })}>
            {children}
        </div>;
    }
}
