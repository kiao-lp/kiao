import React, { useMemo } from 'react';
import { ConfiguredMarkdown } from '@cms-core';

export const RichTextCmp: React.FC<{ style: React.CSSProperties, content: string }> = React.memo(({ style, content }) => {
  const mdContent = useMemo(() => {
    return content || "NO CONTENT";
  }, [content]);

  // A note is a label on a canvas, not a page being read: no crosshair beside its links. The note
  // is sized to its own text and is dragged by the hand that would otherwise have to reach past a
  // button to grab it — and a map is read as a shape, which one more glyph per link works against.
  return <div className={"mindmap-rich-text-view"} style={style}>
    <ConfiguredMarkdown revealLinkTargets={false}>{mdContent}</ConfiguredMarkdown>
  </div>;
});
