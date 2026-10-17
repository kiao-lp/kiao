import React from 'react';
import { Select } from 'antd';
import { InputProps } from '../types';

/**
 * Dropdown component for inline enum values
 * Renders when expression has format: ${var:"a"|"b"|"c"}
 */
export const EnumDropdown: React.FC<InputProps & {
    value: string;
    onChange: (value: string) => void;
}> = ({ enumValues, defaultValue, value, onChange }) => {
    const options = (enumValues || []).map(v => ({
        value: v,
        label: v
    }));

    return (
        <Select
            options={options}
            value={value || defaultValue || (options[0]?.value ?? '')}
            onChange={onChange}
            style={{ width: '100%' }}
            placeholder="Select..."
        />
    );
};
