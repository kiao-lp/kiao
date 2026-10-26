import { useCallback, useEffect } from 'react';
import { createStateContext } from 'react-concise';

const pointedElementContext = createStateContext<string | null>('pointed element', null);

export const PointedElementContextProvider = pointedElementContext.Provider;
export const usePointedElementContext = pointedElementContext.useContext;


export const usePointedElementApi = (element: string) => {
    const [pointedElement, setPointedElement] = usePointedElementContext();

    const point = useCallback(() => {
        setPointedElement(element);
    }, [setPointedElement, element]);

    const unPoint = useCallback(() => {
        setPointedElement(pointedElm => pointedElm === element ? null : pointedElm);
    }, [setPointedElement, element]);

    return {
        pointed: pointedElement === element,
        point,
        unPoint
    };
}

export const useAutoUnpointOnDestroy = (id: string) => {
    const { unPoint } = usePointedElementApi(id);
    useEffect(() => unPoint, [unPoint]);
}
