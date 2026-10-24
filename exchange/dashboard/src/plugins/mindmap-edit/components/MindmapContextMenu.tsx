import React, { useCallback, useMemo } from 'react';
import { MenuProps } from 'antd';
import {
    BgColorsOutlined, CodeOutlined, CopyOutlined, DeleteOutlined, ExpandOutlined,
    FileImageOutlined, FontSizeOutlined, GroupOutlined, LinkOutlined, PlusOutlined,
    PushpinOutlined, ScissorOutlined, SelectOutlined, SnippetsOutlined, UngroupOutlined,
} from '@ant-design/icons';
import { useSelectionContext, useCleanSelectionAndPointing } from '@cms-core';

import { useMindmapStateContext, useMindmapMode } from '../state';
import {
    EndDecoration, MindmapRect, MindmapRelation, MindmapRelationEnd,
    instanceOfMindmapRelation, instanceOfNote,
} from '../model';
import { useMindmapClipboard } from '../hotkeys/useClipboardHotkeys';
import { useDeleteElements } from '../hooks/useDeleteElement';
import {
    useCreateNote, useCreateNoteGroup, useUngroupNotes,
    usePasteLink, usePasteCode, usePasteImage,
} from '../hooks/useNote';
import { filterRelationContainsEndById } from '../hooks/useRelation';
import { useFindRelationEnd, useMapRelationEnd } from '../hooks/useRelationUtils';
import {
    useLargerText, useSmallerText, useWiderRect, useNarrowerRect,
    useTallerRect, useShorterRect, useNaturalSizeRect,
} from '../hooks/useElementSize';

type MenuItems = NonNullable<MenuProps['items']>;

/**
 * The end pinned to one of the twelve places around its note, or — for no number — free of any:
 * the field is taken off rather than set to something outside the twelve, so nothing in a file
 * has to be read as meaning "none".
 */
const withAttachPoint = (end: MindmapRelationEnd, attachPointNumber?: number): MindmapRelationEnd => {
    if (attachPointNumber !== undefined) return { ...end, attachPointNumber };
    const { attachPointNumber: pinned, ...free } = end;
    return free;
};

const label = (testid: string, text: string) => <span data-testid={testid}>{text}</span>;

/**
 * What a right-click on the map offers, in an antd dropdown menu like the file tree's and the
 * boards': the verbs with no key of their own, each with the standard key that says it too where
 * there is one. Opened over the element the click landed on — the selection the click fell in,
 * or the single note it picked out — every choice runs and closes.
 *
 * `menuTarget` is the element id the click landed on, or null on the bare map. It is captured
 * when the menu opens rather than read live: reaching for the menu unpoints the element, and
 * live pointing would swap the menu's contents while it is being read.
 */
export const useMindmapMenuItems = (menuTarget: string | null): {
    items: MenuItems;
    selectedKeys: string[];
} => {
    const [, setMode] = useMindmapMode();
    const { selectElements, saveMindmap } = useMindmapStateContext();
    const [selection, setSelection] = useSelectionContext();
    const cleanSelectionAndPointing = useCleanSelectionAndPointing();
    const { copy, cut, paste } = useMindmapClipboard();
    const deleteElements = useDeleteElements();

    const createNote = useCreateNote();
    const createNoteGroup = useCreateNoteGroup();
    const ungroupNotes = useUngroupNotes();
    const pasteLink = usePasteLink();
    const pasteCode = usePasteCode();
    const pasteImage = usePasteImage();

    const findRelationEnd = useFindRelationEnd();
    const mapRelationEnd = useMapRelationEnd();

    const pointedEnd = menuTarget ? findRelationEnd(menuTarget) : null;
    const targetElement = menuTarget
        ? selectElements(element => element.id === menuTarget)[0]
        : undefined;

    // A right-click picks its note out where it is not already among the selection, so the
    // single-note verbs are shown only when the click's note is the whole of the selection.
    const singleTarget = selection.length === 1 && selection[0] === menuTarget;
    const sizedNote = singleTarget && targetElement && instanceOfNote(targetElement) ? targetElement : null;
    const styledRelation = singleTarget && targetElement && instanceOfMindmapRelation(targetElement)
        ? targetElement
        : null;

    const sizedId = sizedNote ? sizedNote.id : null;
    const largerText = useLargerText(sizedId);
    const smallerText = useSmallerText(sizedId);
    const widerRect = useWiderRect(sizedId);
    const narrowerRect = useNarrowerRect(sizedId);
    const tallerRect = useTallerRect(sizedId);
    const shorterRect = useShorterRect(sizedId);
    const naturalSizeRect = useNaturalSizeRect(sizedId);

    const relationOfEnd = useCallback((endId: string): MindmapRelation | undefined =>
        selectElements(filterRelationContainsEndById(endId))[0] as MindmapRelation | undefined,
        [selectElements]);

    const selectRelationOfEnd = useCallback(() => {
        if (!menuTarget) return;
        const relation = relationOfEnd(menuTarget);
        if (relation) setSelection([relation.id]);
    }, [menuTarget, relationOfEnd, setSelection]);

    const changeDecoration = useCallback((decoration?: EndDecoration) => {
        if (!menuTarget) return;
        mapRelationEnd(end => end.id === menuTarget ? { ...end, decoration } : end);
        saveMindmap();
    }, [menuTarget, mapRelationEnd, saveMindmap]);

    const changeAttachPoint = useCallback((attachPointNumber?: number) => {
        if (!menuTarget) return;
        mapRelationEnd(end => end.id === menuTarget ? withAttachPoint(end, attachPointNumber) : end);
        saveMindmap();
    }, [menuTarget, mapRelationEnd, saveMindmap]);

    const deleteRelationOfEnd = useCallback(() => {
        if (!menuTarget) return;
        const relation = relationOfEnd(menuTarget);
        if (relation) {
            deleteElements([relation.id]);
            cleanSelectionAndPointing();
        }
    }, [menuTarget, relationOfEnd, deleteElements, cleanSelectionAndPointing]);

    const styleRelation = useCallback(() => {
        if (!styledRelation) return;
        setSelection([styledRelation.id]);
        setMode('EDIT_MODIFY_ELEMENT');
    }, [styledRelation, setSelection, setMode]);

    // Delete takes the selection, or the click's own element with nothing selected. Ids are
    // dropped when they match nothing on the map, as the Delete key does.
    const deleteTargeted = useCallback(() => {
        const named = selection.length > 0
            ? selection
            : menuTarget ? [menuTarget] : [];
        deleteElements(selectElements(element => named.includes(element.id)).map(element => element.id));
        cleanSelectionAndPointing();
    }, [selection, menuTarget, selectElements, deleteElements, cleanSelectionAndPointing]);

    const canGroup = selection.length >= 2;
    const canUngroup = selectElements(element => selection.includes(element.id))
        .some(element => (element as MindmapRect).group !== undefined);

    const selectedKeys = useMemo(() => {
        if (!pointedEnd) return [];
        const decoration = `decoration-${pointedEnd.decoration ?? 'none'}`;
        const attach = pointedEnd.attachPointNumber === undefined
            ? 'attach-auto'
            : `attach-${pointedEnd.attachPointNumber}`;
        return [decoration, attach];
    }, [pointedEnd]);

    const items = useMemo(() => {
        const result: MenuItems = [];
        const divider = (key: string) => result.push({ type: 'divider', key });

        if (pointedEnd) {
            result.push({
                key: 'select-relation',
                icon: <SelectOutlined />,
                label: label('mindmap-menu-select-relation', 'Select relation'),
                onClick: selectRelationOfEnd,
            });
            result.push({
                key: 'decoration',
                label: label('mindmap-menu-decoration', 'End decoration'),
                children: ([
                    ['none', 'None', undefined],
                    ['EMPTY_TRIANGLE', 'Empty triangle', 'EMPTY_TRIANGLE'],
                    ['FULL_TRIANGLE', 'Full triangle', 'FULL_TRIANGLE'],
                    ['EMPTY_RECTANGLE', 'Empty rectangle', 'EMPTY_RECTANGLE'],
                    ['FULL_RECTANGLE', 'Full rectangle', 'FULL_RECTANGLE'],
                ] as [string, string, EndDecoration | undefined][]).map(([key, text, decoration]) => ({
                    key: `decoration-${key}`,
                    label: text,
                    onClick: () => changeDecoration(decoration),
                })),
            });
            result.push({
                key: 'attach',
                icon: <PushpinOutlined />,
                label: label('mindmap-menu-attach', 'Attach point'),
                children: [
                    { key: 'attach-auto', label: 'Automatic', onClick: () => changeAttachPoint(undefined) },
                    ...Array.from({ length: 12 }, (_, at) => ({
                        key: `attach-${at}`,
                        label: `${at}`,
                        onClick: () => changeAttachPoint(at),
                    })),
                ],
            });
            divider('sep-end-delete');
            result.push({
                key: 'delete-relation',
                icon: <DeleteOutlined />,
                label: label('mindmap-menu-delete', 'Delete relation'),
                danger: true,
                onClick: deleteRelationOfEnd,
            });
            return result;
        }

        const hasSelection = selection.length > 0;

        if (!hasSelection) {
            result.push({
                key: 'new-note',
                icon: <PlusOutlined />,
                label: label('mindmap-menu-new-note', 'New note'),
                extra: 'Double-click',
                onClick: () => createNote(undefined),
            });
            divider('sep-new');
            result.push({
                key: 'paste',
                icon: <SnippetsOutlined />,
                label: label('mindmap-menu-paste', 'Paste'),
                extra: 'Ctrl+V',
                onClick: () => { void paste(); },
            });
            result.push({
                key: 'paste-link',
                icon: <LinkOutlined />,
                label: label('mindmap-menu-paste-link', 'Paste link'),
                onClick: () => { void pasteLink(); },
            });
            result.push({
                key: 'paste-code',
                icon: <CodeOutlined />,
                label: label('mindmap-menu-paste-code', 'Paste code'),
                onClick: () => { void pasteCode(); },
            });
            result.push({
                key: 'paste-image',
                icon: <FileImageOutlined />,
                label: label('mindmap-menu-paste-image', 'Paste image'),
                onClick: () => { void pasteImage(); },
            });
            return result;
        }

        result.push({
            key: 'cut',
            icon: <ScissorOutlined />,
            label: label('mindmap-menu-cut', 'Cut'),
            extra: 'Ctrl+X',
            onClick: () => { void cut(selection); },
        });
        result.push({
            key: 'copy',
            icon: <CopyOutlined />,
            label: label('mindmap-menu-copy', 'Copy'),
            extra: 'Ctrl+C',
            onClick: () => { void copy(selection); },
        });
        result.push({
            key: 'paste',
            icon: <SnippetsOutlined />,
            label: label('mindmap-menu-paste', 'Paste'),
            extra: 'Ctrl+V',
            onClick: () => { void paste(); },
        });

        if (canGroup || canUngroup) {
            divider('sep-group');
            if (canGroup) {
                result.push({
                    key: 'group',
                    icon: <GroupOutlined />,
                    label: label('mindmap-menu-group', 'Group'),
                    extra: 'Ctrl+G',
                    onClick: createNoteGroup,
                });
            }
            if (canUngroup) {
                result.push({
                    key: 'ungroup',
                    icon: <UngroupOutlined />,
                    label: label('mindmap-menu-ungroup', 'Ungroup'),
                    extra: 'Ctrl+Shift+G',
                    onClick: ungroupNotes,
                });
            }
        }

        if (sizedNote) {
            divider('sep-size');
            result.push({
                key: 'text-size',
                icon: <FontSizeOutlined />,
                label: label('mindmap-menu-text-size', 'Text size'),
                children: [
                    { key: 'text-larger', label: 'Larger', onClick: largerText },
                    { key: 'text-smaller', label: 'Smaller', onClick: smallerText },
                ],
            });
            result.push({
                key: 'note-size',
                icon: <ExpandOutlined />,
                label: label('mindmap-menu-note-size', 'Note size'),
                children: [
                    { key: 'rect-wider', label: 'Wider', onClick: widerRect },
                    { key: 'rect-narrower', label: 'Narrower', onClick: narrowerRect },
                    { key: 'rect-taller', label: 'Taller', onClick: tallerRect },
                    { key: 'rect-shorter', label: 'Shorter', onClick: shorterRect },
                    { key: 'rect-natural', label: 'Natural size', onClick: naturalSizeRect },
                ],
            });
        }

        if (styledRelation) {
            divider('sep-style');
            result.push({
                key: 'style-relation',
                icon: <BgColorsOutlined />,
                label: label('mindmap-menu-style-relation', 'Style relation'),
                onClick: styleRelation,
            });
        }

        divider('sep-delete');
        result.push({
            key: 'delete',
            icon: <DeleteOutlined />,
            label: label('mindmap-menu-delete', 'Delete'),
            extra: 'Del',
            danger: true,
            onClick: deleteTargeted,
        });

        return result;
    }, [
        pointedEnd, selection, canGroup, canUngroup, sizedNote, styledRelation,
        createNote, copy, cut, paste, pasteLink, pasteCode, pasteImage,
        createNoteGroup, ungroupNotes, selectRelationOfEnd, changeDecoration,
        changeAttachPoint, deleteRelationOfEnd, styleRelation, deleteTargeted,
        largerText, smallerText, widerRect, narrowerRect, tallerRect, shorterRect, naturalSizeRect,
    ]);

    return { items, selectedKeys };
};
