import React, { MouseEvent, useState } from 'react';
import { Input } from 'antd';
import { AudioOutlined } from '@ant-design/icons';
import type { TextAreaProps } from 'antd/es/input';
import { useVoiceInput as useVoiceInputContext } from './VoiceInputContext';
import { useVoiceInputHook } from './useVoiceInputHook';
import { Tooltip } from '../Tooltip';
import './VoiceInput.css';

export interface VoiceTextAreaProps extends TextAreaProps { }

const stopEvent = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
};

export const VoiceTextArea: React.FC<VoiceTextAreaProps> = (props) => {
    const { defaultValue, value, onChange, className, style, ...restProps } = props;
    const { language } = useVoiceInputContext();

    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = useState<string | number | readonly string[] | undefined>(defaultValue);

    const effectiveValue = isControlled ? value : internalValue;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (!isControlled) {
            setInternalValue(e.target.value);
        }
        if (onChange) {
            onChange(e);
        }
    };

    const { showMic, listening, toggleListening } = useVoiceInputHook(handleChange as any, effectiveValue, language);

    if (!showMic) {
        return <Input.TextArea className={className} style={style} {...restProps} value={effectiveValue} onChange={handleChange} />;
    }

    return (
        <div
            className={`voice-input-wrapper ${className || ''}`}
            style={style}
        >
            <Input.TextArea
                {...restProps}
                value={effectiveValue}
                onChange={handleChange}
                className="voice-textarea-inner"
                style={{ resize: style?.resize }}
            />
            <div className="voice-textarea-controls">
                <Tooltip title="Voice Input">
                    <span
                        onMouseDown={stopEvent}
                        onMouseUp={stopEvent}
                        onClick={toggleListening}
                        className="voice-input-mic-icon"
                        aria-label="Voice Input"
                    >
                        <AudioOutlined className={listening ? 'voice-input-mic-active' : 'voice-input-mic-inactive'} />
                    </span>
                </Tooltip>
            </div>
        </div>
    );
};
