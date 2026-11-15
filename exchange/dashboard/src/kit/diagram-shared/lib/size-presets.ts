export interface DiagramSizePreset {
    label: string;
    width: number;
    height: number;
}

export const DIAGRAM_SIZE_PRESETS: DiagramSizePreset[] = [
    { label: 'Small (640\u00d7480)',    width: 640,  height: 480 },
    { label: 'Medium (925\u00d7768)',   width: 925,  height: 768 },
    { label: 'Large (1280\u00d7960)',   width: 1280, height: 960 },
    { label: 'Wide (1600\u00d7900)',    width: 1600, height: 900 },
    { label: 'XL (1920\u00d71080)',     width: 1920, height: 1080 },
];
