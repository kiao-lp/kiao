import React, { useMemo } from 'react';
import { ConfiguredMarkdown } from '@cms-core';

export const RichTextCmp: React.FC<{ style: React.CSSProperties, content: string }> = React.memo(({ style, content }) => {
  const mdContent = useMemo(() => {
    return content || "NO CONTENT";
  }, [content]);

  return <div className={"mindmap-rich-text-view"} style={style}>
    <ConfiguredMarkdown revealLinkTargets={false}>{mdContent}</ConfiguredMarkdown>
  </div>;
});
