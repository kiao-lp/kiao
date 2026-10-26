import React, { FocusEvent, KeyboardEvent, SyntheticEvent, useCallback, useEffect, useLayoutEffect, useRef, useState, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { markdownLinkDropHandlers, VoiceTextArea } from '@cms-core';

export interface RichTextAreaCmpProps {
  defaultValue: string;
  toolbar?: React.ReactNode;
  onBlur?: (value: string, defaultValue: string) => void;
  onUnMount?: (value: string, defaultValue: string) => void;
  onClose?: () => void;
}

// --- Constants & Static Helpers ---

// Wide enough for the whole toolbar row — the eight selectors and the trash button — to fit
// on one line; the textarea below simply takes that same width. styles.css holds the same width
// as a floor, so the two move together.
const DIMENSIONS = { width: 420, height: 320 };
const SCREEN_MARGIN = 10;

const stopPropagation = (e: SyntheticEvent) => e.stopPropagation();

export const parseSelectedText = (text: string) => {
  const startIdx = text.indexOf("{{{");
  if (startIdx === -1) return { content: text, start: null, end: null };

  const endIdx = text.indexOf("}}}");
  return {
    content: text.slice(0, startIdx) + text.slice(startIdx + 3, endIdx) + text.slice(endIdx + 3),
    start: startIdx,
    end: endIdx - 3
  };
};

const calculatePosition = (targetRect: DOMRect | null): CSSProperties => {
  const { width, height } = DIMENSIONS;

  if (!targetRect) {
    return {
      ...DIMENSIONS,
      top: (window.innerHeight - height) / 2,
      left: (window.innerWidth - width) / 2
    };
  }

  const left = (targetRect.left + targetRect.width / 2) - (width / 2);
  const top = (targetRect.top + targetRect.height / 2) - (height / 2);

  return {
    ...DIMENSIONS,
    left: Math.max(SCREEN_MARGIN, Math.min(left, window.innerWidth - width - SCREEN_MARGIN)),
    top: Math.max(SCREEN_MARGIN, Math.min(top, window.innerHeight - height - SCREEN_MARGIN))
  };
};

// --- Component ---

export const RichTextAreaCmp: React.FC<RichTextAreaCmpProps> = ({ defaultValue, toolbar, onBlur, onUnMount, onClose }) => {
  // 1. Initialization
  const [{ content, start, end }] = useState(() => parseSelectedText(defaultValue));
  const [value, setValue] = useState(content);
  const [position, setPosition] = useState<CSSProperties | null>(null);

  const placeholderRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value; // Keep ref synced for lifecycle events

  // 2. Positioning (Measure once before paint)
  useLayoutEffect(() => {
    const rect = placeholderRef.current?.parentElement?.getBoundingClientRect() ?? null;
    setPosition(calculatePosition(rect));
  }, []);

  // 3. Lifecycle Handlers
  // Note: We maintain exact behavior of original useEffect regarding onUnMount timing
  useEffect(() => {
    if (onUnMount) return () => onUnMount(valueRef.current, defaultValue);
  }, [onUnMount, defaultValue]);

  const handleBlur = useCallback(() => {
    if (onBlur) onBlur(valueRef.current, defaultValue);
  }, [onBlur, defaultValue]);

  // Enter alone writes a line, so it is Ctrl+Enter — Cmd+Enter on a Mac — that says the note
  // is written: the popup goes, leaving the text to be kept as a click away from it would.
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    onClose?.();
  }, [onClose]);

  // A note open for editing has its text in this box and no longer on the map, so a file dragged
  // out of the file navigator is taken here rather than by the note behind — and, the caret being
  // where the box has been putting it as the drag moved over it, the link goes in where it was
  // dropped rather than at the end. It is the same link the map's own drop writes.
  const linkDrop = markdownLinkDropHandlers(value, setValue);

  const handleFocus = useCallback((e: FocusEvent<HTMLTextAreaElement>) => {
    setTimeout(() => {
      if (start !== null && end !== null) {
        e.target.setSelectionRange(start, end);
      } else {
        e.target.select();
      }
    }, 10);
  }, [start, end]);

  // 4. Render
  if (!position) return <span ref={placeholderRef} style={{ display: 'none' }} />;

  return createPortal(
    // The portal keeps the popup out of the mindmap DOM, but React still bubbles its
    // events to the viewport, which would leave edit mode: grabbing the resize grip
    // must not do that.
    <div
      className="mindmap-rich-text-editor-wrapper"
      style={position}
      onMouseDown={stopPropagation}
      onMouseUp={stopPropagation}
      onClick={stopPropagation}
      onKeyDown={handleKeyDown}
    >
      {toolbar}
      <VoiceTextArea
        className="mindmap-rich-text-editor"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onMouseDown={stopPropagation}
        onMouseUp={stopPropagation}
        onClick={stopPropagation}
        {...linkDrop}
      />
    </div>,
    document.body
  );
};
