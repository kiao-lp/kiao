import React, { useState } from 'react';
import { Button, Flex, Popover } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';

export const UnicodePaletteCmp: React.FC = () => {
    const [open, setOpen] = useState(false);

    const handleCopy = (char: string) => {
        navigator.clipboard.writeText(char);
        setOpen(false);
    };

    const unicodeContent = (
        <Flex gap="small" wrap="wrap" style={{ maxWidth: '200px' }} onClick={e => e.stopPropagation()}>
            {[
                '⚠️', '🔍', '🧠', '✔️', '❌', '❓', '❗', '⭐', '🔥', '💡',
                '🔎', '✅', '⚙️', '🧩', '📦', '🔗', '🐳', '🌐', '💬',
                '☒', '☐', '▣', '⚠', '📍', '📧', '▶️', '📹', '★', '🌍',
                '🇬🇧', '🇺🇸', '🇨🇳', '🇩🇪', '🇫🇷', '🇨🇭',
                '📐', '🎨', '🖥️', '</>', '🏡',
                '🟢', '🟠', '🔴', '⚫'
            ].map(char => (
                <Button key={char} size="small" onClick={() => handleCopy(char)}>
                    {char}
                </Button>
            ))}
        </Flex>
    );

    return (
        <Popover content={unicodeContent} title="Unicode Palette" trigger="click" open={open} onOpenChange={setOpen}>
            <Button
                type="text"
                size="small"
                style={{ fontSize: '1.2em', lineHeight: 1 }}
            >
                <AppstoreOutlined />
            </Button>
        </Popover>
    );
};
