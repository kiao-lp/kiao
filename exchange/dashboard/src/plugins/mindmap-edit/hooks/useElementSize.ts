import { useCallback } from 'react';
import { useMindmapStateContext } from '../state';
import { MindmapText, MindmapRect, USER_BOUND_AUTO } from '../model';

export const useLargerText = (targetId: string | null) => {
    const { saveMindmap, mapElements } = useMindmapStateContext();

    return useCallback(() => {
        if (targetId) {
            mapElements((element) => {
                if (element.id !== targetId) return element;
                const fontSize = (element as MindmapText).fontSize || 20;
                return { ...element, fontSize: fontSize + 2 };
            });
            saveMindmap();
        }
    }, [targetId, mapElements, saveMindmap]);
}

export const useSmallerText = (targetId: string | null) => {
    const { mapElements, saveMindmap } = useMindmapStateContext();

    return useCallback(() => {
        if (targetId) {
            mapElements((element) => {
                if (element.id !== targetId) return element;
                const fontSize = (element as MindmapText).fontSize || 20;
                return { ...element, fontSize: fontSize - 2 };
            });
            saveMindmap();
        }
    }, [targetId, mapElements, saveMindmap]);
}

// Grid units per step.
const SIZE_STEP = 10;

export const useWiderRect = (targetId: string | null) => {
    const { mapElements, saveMindmap } = useMindmapStateContext();

    return useCallback(() => {
        if (targetId) {
            mapElements((element) => {
                if (element.id !== targetId) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const currentWidth = w ?? rect.bounds?.[2] ?? 100;
                const newWidth = currentWidth + SIZE_STEP;
                return { ...element, userBounds: [x - SIZE_STEP / 2, y, newWidth, h] };
            });
            saveMindmap();
        }
    }, [targetId, mapElements, saveMindmap]);
}

export const useNarrowerRect = (targetId: string | null) => {
    const { mapElements, saveMindmap } = useMindmapStateContext();

    return useCallback(() => {
        if (targetId) {
            mapElements((element) => {
                if (element.id !== targetId) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const currentWidth = w ?? rect.bounds?.[2] ?? 100;
                const newWidth = Math.max(SIZE_STEP, currentWidth - SIZE_STEP);
                const widthDecrease = currentWidth - newWidth;
                return { ...element, userBounds: [x + widthDecrease / 2, y, newWidth, h] };
            });
            saveMindmap();
        }
    }, [targetId, mapElements, saveMindmap]);
}

export const useTallerRect = (targetId: string | null) => {
    const { mapElements, saveMindmap } = useMindmapStateContext();

    return useCallback(() => {
        if (targetId) {
            mapElements((element) => {
                if (element.id !== targetId) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const currentHeight = h ?? rect.bounds?.[3] ?? 100;
                const newHeight = currentHeight + SIZE_STEP;
                return { ...element, userBounds: [x, y - SIZE_STEP / 2, w, newHeight] };
            });
            saveMindmap();
        }
    }, [targetId, mapElements, saveMindmap]);
}

export const useShorterRect = (targetId: string | null) => {
    const { mapElements, saveMindmap } = useMindmapStateContext();

    return useCallback(() => {
        if (targetId) {
            mapElements((element) => {
                if (element.id !== targetId) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const currentHeight = h ?? rect.bounds?.[3] ?? 100;
                const newHeight = Math.max(SIZE_STEP, currentHeight - SIZE_STEP);
                const heightDecrease = currentHeight - newHeight;
                return { ...element, userBounds: [x, y + heightDecrease / 2, w, newHeight] };
            });
            saveMindmap();
        }
    }, [targetId, mapElements, saveMindmap]);
}
export const useNaturalSizeRect = (targetId: string | null) => {
    const { mapElements, saveMindmap } = useMindmapStateContext();

    return useCallback(() => {
        if (targetId) {
            mapElements((element) => {
                if (element.id !== targetId) return element;
                const rect = element as MindmapRect;
                const [x, y, w, h] = rect.userBounds;
                const bounds = rect.bounds ?? [x, y, 100, 100];
                const currentWidth = w ?? bounds[2];
                const currentHeight = h ?? bounds[3];
                const centerX = x + currentWidth / 2;
                const centerY = y + currentHeight / 2;
                const naturalWidth = bounds[2];
                const naturalHeight = bounds[3];
                const newX = centerX - naturalWidth / 2;
                const newY = centerY - naturalHeight / 2;
                return { ...element, userBounds: [newX, newY, USER_BOUND_AUTO, USER_BOUND_AUTO] };
            });
            saveMindmap();
        }
    }, [targetId, mapElements, saveMindmap]);
}
