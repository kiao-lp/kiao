import React, { MouseEvent, useState } from 'react';
import { Input } from 'antd';
import { AudioOutlined } from '@ant-design/icons';
import type { InputProps } from 'antd';
import { useVoiceInput as useVoiceInputContext } from './VoiceInputContext';
import { useVoiceInputHook } from './useVoiceInputHook';
import { Tooltip } from '../Tooltip';
import './VoiceInput.css';

export interface VoiceInputProps extends InputProps { }

const stopEvent = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
};

export const VoiceInput: React.FC<VoiceInputProps> = (props) => {
    const { defaultValue, value, onChange, ...restProps } = props;
    const { language } = useVoiceInputContext();

    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = useState<string | number | readonly string[] | undefined>(defaultValue);

    const effectiveValue = isControlled ? value : internalValue;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!isControlled) {
            setInternalValue(e.target.value);
        }
        if (onChange) {
            onChange(e);
        }
    };

    const { showMic, listening, toggleListening } = useVoiceInputHook(handleChange as any, effectiveValue, language);

    return (
        <Input
            {...restProps}
            value={effectiveValue}
            onChange={handleChange}
            suffix={
                showMic ? (
                    <div className="voice-input-suffix">
                        {props.suffix}
                        <Tooltip title="Voice Input">
                            <span
                                onMouseDown={stopEvent}
                                onMouseUp={stopEvent}
                                onClick={toggleListening}
                                className="voice-input-mic-icon"
                                aria-label="Voice Input"
                            >
                                <AudioOutlined className={listening ? 'voice-input-mic-active' : ''} />
                            </span>
                        </Tooltip>
                    </div>
                ) : (
                    props.suffix
                )
            }
        />
    );
};
