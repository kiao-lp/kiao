import React from 'react';
import { Input } from 'antd';
import type { TextAreaProps } from 'antd/es/input';
import classNames from 'classnames';
import { VoiceInputButton } from './VoiceInputButton';
import { useVoiceField } from './useVoiceField';
import './VoiceInput.css';

export type VoiceTextAreaProps = TextAreaProps;

export const VoiceTextArea: React.FC<VoiceTextAreaProps> = ({
    value, defaultValue, onChange, className, style, ...props
}) => {
    const field = useVoiceField({ value, defaultValue, onChange });
    const textarea = { ...props, value: field.value, onChange: field.onChange };

    return (
        <VoiceInputButton value={field.text} onChange={field.dictate} disabled={props.readOnly || props.disabled}>
            {button => button ? (
                <div className={classNames('voice-input-wrapper', className)} style={style}>
                    <Input.TextArea
                        {...textarea}
                        className="voice-textarea-inner"
                        style={{ resize: style?.resize, fontFamily: style?.fontFamily }}
                    />
                    {button}
                </div>
            ) : <Input.TextArea {...textarea} className={className} style={style} />}
        </VoiceInputButton>
    );
};
