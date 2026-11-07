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


export const RichTextAreaCmp: React.FC<RichTextAreaCmpProps> = ({ defaultValue, toolbar, onBlur, onUnMount, onClose }) => {
  const [{ content, start, end }] = useState(() => parseSelectedText(defaultValue));
  const [value, setValue] = useState(content);
  const [position, setPosition] = useState<CSSProperties | null>(null);

  const placeholderRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useLayoutEffect(() => {
    const rect = placeholderRef.current?.parentElement?.getBoundingClientRect() ?? null;
    setPosition(calculatePosition(rect));
  }, []);

  useEffect(() => {
    if (onUnMount) return () => onUnMount(valueRef.current, defaultValue);
  }, [onUnMount, defaultValue]);

  const handleBlur = useCallback(() => {
    if (onBlur) onBlur(valueRef.current, defaultValue);
  }, [onBlur, defaultValue]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    onClose?.();
  }, [onClose]);

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

  if (!position) return <span ref={placeholderRef} style={{ display: 'none' }} />;

  return createPortal(
    // must not do.
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
