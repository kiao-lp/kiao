import React, { useMemo } from 'react';
import classNames from 'classnames';

import { RichText } from '../../model';
import { RichTextAreaCmp } from './RichTextArea-cmp';
import { RichTextCmp } from './RichText-cmp';

export interface EditableTextCmpProps extends RichText {
  isEdited: boolean;
  toolbar?: React.ReactNode;
  onBlur?: (value: string, defaultValue: string) => void;
  onUnMount?: (value: string, defaultValue: string) => void;
  onClose?: () => void;
  className?: string;
}

export const useRichTextCssStyle = (richText: RichText) => {
  const { fontSize } = richText;
  const style = useMemo(() => ({ fontSize }), [fontSize]);
  return style;
}

export const EditableRichTextCmp: React.FC<EditableTextCmpProps> = (props) => {
  const { content, isEdited, toolbar, onBlur, onUnMount, onClose, className } = props;

  const style = useRichTextCssStyle(props);

  return (
    <div className={classNames('editable-rich-text', className)}>
      {isEdited
        ? <RichTextAreaCmp defaultValue={content} toolbar={toolbar} onBlur={onBlur} onUnMount={onUnMount} onClose={onClose} />
        : <RichTextCmp content={content} style={style} />}
    </div>
  );
};
