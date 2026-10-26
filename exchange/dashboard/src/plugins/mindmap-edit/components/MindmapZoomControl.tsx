import React from 'react';
import { useMindmapStateContext } from '../state';
import { ZoomControl } from '@cms-kit/zoom-control';

export const MindmapZoomControl: React.FC = () => {
    const { zoom, setZoom } = useMindmapStateContext();

    return (
        <ZoomControl
            zoom={zoom}
            onZoomChange={setZoom}
            className="mindmap-zoom-control"
        />
    );
};

