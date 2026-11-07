import React, { CSSProperties, SyntheticEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select } from 'antd';
import { DeleteOutlined, LineOutlined, SwapOutlined } from '@ant-design/icons';
import { useCleanSelectionAndPointing } from '@cms-core';

import { MindmapRelation, RelationBody, RelationColor } from '../model';
import { useDeleteElement } from '../hooks/useDeleteElement';
import { useFlipRelationBody, useShapeRelationBody, useStraightenRelation } from '../hooks/useRelation';
import { relationBody, relationBodyWidth } from '../hooks/useRelationUtils';
import { useMindmapStateContext } from '../state';
import { bodyOptions, bodyWidthOptionsAround, relationColorOptions } from '../lib/relation-style-options';
import { colorSelectProps } from '../lib/color-select';


const MARGIN = 10;
const OFFSET = 8;

const calculatePosition = (anchorRect: DOMRect, menuEl: HTMLDivElement): CSSProperties => {
    const menuWidth = menuEl.offsetWidth;
    const menuHeight = menuEl.offsetHeight;
    const left = anchorRect.left + anchorRect.width / 2 - menuWidth / 2;
    const top = anchorRect.top - menuHeight - OFFSET;
    return {
        left: Math.max(MARGIN, Math.min(left, window.innerWidth - menuWidth - MARGIN)),
        top: Math.max(MARGIN, Math.min(top, window.innerHeight - menuHeight - MARGIN)),
    };
};


const stopPropagation = (e: SyntheticEvent) => e.stopPropagation();

interface RelationContextMenuProps {
    relation: MindmapRelation;
    anchorRect: DOMRect;
    onClose: () => void;
}

/** What a relation is styled from: its centre. */
export const RelationContextMenuCmp: React.FC<RelationContextMenuProps> = ({ relation, anchorRect, onClose }) => {
    const cleanSelectionAndPointing = useCleanSelectionAndPointing();
    const deleteElement = useDeleteElement();
    const straightenRelation = useStraightenRelation();
    const shapeRelationBody = useShapeRelationBody();
    const flipRelationBody = useFlipRelationBody();
    const { patchElement, saveMindmap } = useMindmapStateContext();
    const menuRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<CSSProperties | null>(null);

    const selectProps = useMemo(() => ({
        size: 'small' as const,
        style: { width: 'auto' } as CSSProperties,
        styles: { popup: { root: { zIndex: 10001 } } },
        popupMatchSelectWidth: false
    }), []);

    useLayoutEffect(() => {
        if (menuRef.current) setPosition(calculatePosition(anchorRect, menuRef.current));
    }, [anchorRect]);

    useEffect(() => {
        const handlePointerDown = (e: PointerEvent) => {
            const target = e.target as Element;
            if (target.closest?.('.ant-select-dropdown')) return;

            if (menuRef.current && !menuRef.current.contains(target)) {
                onClose();
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [onClose]);

    // The body is the relation's, but the hooks behind it are addressed to an end, because which end a triangle comes to a point at is.
    const firstEndId = relation.ends[0].id;
    const body = relationBody(relation);
    const width = relationBodyWidth(relation);

    const changeBody = useCallback((chosen: RelationBody) => {
        shapeRelationBody(firstEndId, chosen);
        saveMindmap();
    }, [shapeRelationBody, firstEndId, saveMindmap]);

    const changeWidth = useCallback((chosen: number) => {
        patchElement<MindmapRelation>('relations', relation.id, {
            ends: relation.ends.map(end => ({ ...end, width: end.width === 0 ? 0 : chosen })) as MindmapRelation['ends']
        });
        saveMindmap();
    }, [patchElement, relation.id, relation.ends, saveMindmap]);

    const changeColor = useCallback((chosen: string) => {
        patchElement<MindmapRelation>('relations', relation.id, { color: (chosen || undefined) as RelationColor });
        saveMindmap();
    }, [patchElement, relation.id, saveMindmap]);

    const handleFlip = useCallback(() => {
        flipRelationBody(firstEndId);
        saveMindmap();
    }, [flipRelationBody, firstEndId, saveMindmap]);

    const handleStraighten = useCallback(() => {
        straightenRelation(relation.id);
        saveMindmap();
        onClose();
    }, [straightenRelation, saveMindmap, relation.id, onClose]);

    const handleDelete = useCallback(() => {
        deleteElement(relation.id);
        cleanSelectionAndPointing();
        onClose();
    }, [deleteElement, cleanSelectionAndPointing, relation.id, onClose]);

    const style: CSSProperties = position
        ? position
        : { visibility: 'hidden' };

    return createPortal(
        <div
            ref={menuRef}
            className="relation-context-menu"
            style={style}
            onMouseDown={stopPropagation}
            onMouseUp={stopPropagation}
            onClick={stopPropagation}
        >
            <Select
                {...selectProps}
                value={body}
                options={bodyOptions}
                onChange={changeBody}
                title="Body"
            />
            {body !== 'line' && <Select
                {...selectProps}
                value={width}
                options={bodyWidthOptionsAround(width)}
                onChange={changeWidth}
                title="Body width"
            />}
            <Select
                {...selectProps}
                {...colorSelectProps}
                value={relation.color ?? ''}
                options={relationColorOptions}
                onChange={changeColor}
                title="Colour"
            />
            {body === 'triangle' && <Button
                size="small"
                type="text"
                icon={<SwapOutlined />}
                onClick={handleFlip}
                title="Turn the triangle round"
            />}
            {relation.bend && <Button
                size="small"
                type="text"
                icon={<LineOutlined />}
                onClick={handleStraighten}
                title="Straighten relation"
            />}
            <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={handleDelete}
                title="Delete relation"
            />
        </div>,
        document.body
    );
};
