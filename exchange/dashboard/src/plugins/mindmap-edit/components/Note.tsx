import React from 'react';
import { MindmapElementOwner, Note } from '../model';
import { MindmapRectCmp } from './MindmapRect';
import { MindmapTextCmp } from './MindmapText';
import { DiamondNoteSvg } from './DiamondNoteSvg';

export const NoteCmp: React.FC<MindmapElementOwner<Note>> = React.memo(({ element }) => {
    const classes = [
        element.shape ? `note-shape-${element.shape}` : undefined,
        element.edge ? `note-edge-${element.edge.toLowerCase().replace(' ', '-')}` : undefined,
        element.borderColor ? `note-border-${element.borderColor}` : undefined,
        element.background ? `note-bg-${element.background}` : undefined,
        element.textAlign ? `note-align-${element.textAlign}` : undefined,
        element.verticalAlign ? `note-valign-${element.verticalAlign}` : undefined
    ].filter(Boolean).join(' ');

    return (
        <div className={classes || undefined}>
            <MindmapRectCmp {...element}>
                {element.shape === 'diamond' && <DiamondNoteSvg element={element} />}
                <MindmapTextCmp element={element} />
            </MindmapRectCmp>
        </div>
    );
});
