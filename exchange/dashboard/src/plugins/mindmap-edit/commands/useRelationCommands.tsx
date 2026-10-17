import React, { useMemo } from 'react';
import { CommandDescriptor } from '@cms-core';
import { usePointedElementContext } from 'react-advanced-interactions';

// State & Models
import { useMindmapStateContext, useMindmapMode } from '../state';
import { EndDecoration, MindmapRelationEnd } from '../model';

// Hooks
import { useSelectRelation } from '../hooks/useRelation';
import { useFindRelationEnd, useMapRelationEnd } from '../hooks/useRelationUtils';

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

// === Main Relation Commands Hook ===

export const useRelationCommands = () => {
    const [mode] = useMindmapMode();
    const { saveMindmap } = useMindmapStateContext();
    const [pointedElement] = usePointedElementContext();

    // Hooks
    const selectRelation = useSelectRelation();
    const findRelationEnd = useFindRelationEnd();
    const mapRelationEnd = useMapRelationEnd();

    // Computed
    const foundRelationEnd = pointedElement ? findRelationEnd(pointedElement) : null;

    return useMemo(() => {
        const cmds: CommandDescriptor[] = [];

        // === Relation Commands ===
        // A relation is made by pulling one out of a note towards another — shift and a drag —
        // and has no shortcut here, the gesture saying from which of the two notes it runs.
        cmds.push({
            id: 'select-relation',
            shortcut: 'sr',
            title: <>sr.Select relation</>,
            enabledWhen: () => mode === 'EDIT' && !!foundRelationEnd,
            execute: selectRelation
        });

        // Decoration commands
        const addDecorationCmd = (shortcut: string, decoration?: EndDecoration) => {
            cmds.push({
                id: `change-end-${shortcut}`,
                group: 'd{et|ft|er|fr|xx}',
                shortcut,
                title: <>d &#123; et| ft | er | fr | xx &#125;. Change decoration </>,
                enabledWhen: () => mode === 'EDIT' && !!foundRelationEnd,
                execute: () => {
                    if (pointedElement) {
                        mapRelationEnd(end => end.id === pointedElement ? { ...end, decoration } : end);
                        saveMindmap();
                    }
                }
            });
        };
        addDecorationCmd('det', 'EMPTY_TRIANGLE');
        addDecorationCmd('dft', 'FULL_TRIANGLE');
        addDecorationCmd('der', 'EMPTY_RECTANGLE');
        addDecorationCmd('dfr', 'FULL_RECTANGLE');
        addDecorationCmd('dxx', undefined);

        // What a relation is drawn as — its body, its width, its colour, which way round a
        // triangle points — is chosen from the menu its centre opens, and has no shortcut here:
        // each is a choice among pictures, which a selector shows and a two letter word cannot.

        // Attach point commands. `m99` is the slot outside the twelve: it takes the number off
        // the end, which is what leaves it free to follow the notes as they move.
        const addAttachPointCmd = (shortcut: string, title: React.ReactNode, attachPointNumber?: number) => {
            cmds.push({
                id: attachPointNumber === undefined ? 'attach-automatically' : `attach-point-${attachPointNumber}`,
                group: 'm[00-11|99]',
                shortcut,
                title,
                enabledWhen: () => mode === 'EDIT' && !!foundRelationEnd,
                execute: () => {
                    if (!pointedElement) return;
                    mapRelationEnd(end => end.id === pointedElement ? withAttachPoint(end, attachPointNumber) : end);
                    saveMindmap();
                }
            });
        };

        for (let i = 0; i < 12; i++) {
            addAttachPointCmd(i < 10 ? `m0${i}` : `m${i}`, <>m[00 - 11].Attach to...</>, i);
        }
        addAttachPointCmd('m99', <>m99.Attach automatically</>);

        return cmds;
    }, [mode, foundRelationEnd, saveMindmap, selectRelation, pointedElement, mapRelationEnd]);
};
