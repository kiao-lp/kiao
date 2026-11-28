import { ZoomControl } from '@kiao-dashboard-core';
import { useMindmapStateContext } from '../state';

export const MindmapZoomControl = () => {
    const { zoom, setZoom } = useMindmapStateContext();
    return <ZoomControl zoom={zoom} onZoomChange={setZoom} />;
};
