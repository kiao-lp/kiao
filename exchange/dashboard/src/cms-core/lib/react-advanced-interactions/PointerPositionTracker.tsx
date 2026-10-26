import React, { MouseEvent, RefObject, useRef, useState } from 'react';
import { createSimpleContext } from 'react-concise';

export const dontCallMeFn = (name: string) => () => { 
    console.error(`${name} shouldn't be called`)
};

// pointed location

type OnTrackedMouseEvent = (mouseEvent: MouseEvent) => void;

type Value = [RefObject<HTMLDivElement> | null, OnTrackedMouseEvent, number[]]

const defaultValue: Value = [null, dontCallMeFn(`default pointed location setter`), []];

const pointedLocationContext = createSimpleContext(
    (): Value => {
        // Stable across renders: a ref made per render is filled only on mount once a parent
        // composes it into a memoized callback, as the mindmap's dropdown menu does.
        const diagramDivRef = useRef<HTMLDivElement>(null);
        const [pointedLocation, setPointedLocation] = useState<number[]>([]);

        const onTrackedMouseEvent = (mouseEvent: MouseEvent) => {
            if (diagramDivRef.current) {
                const boundingRect = diagramDivRef.current.getBoundingClientRect();
                setPointedLocation([mouseEvent.clientX - boundingRect.x, mouseEvent.clientY - boundingRect.y]);
            }
        };

        return [diagramDivRef, onTrackedMouseEvent, pointedLocation];
    },
    defaultValue,
);

const PointedLocationProvider = pointedLocationContext.Provider;
export const usePointedLocationTracker = pointedLocationContext.useContext;
export const withPointedLocationTracker = (Component: React.FC<{}>) => () => <PointedLocationProvider><Component /></PointedLocationProvider>;
