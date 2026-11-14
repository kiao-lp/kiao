import React from 'react';
import { Typography, theme } from 'antd';

/** Checkerboard so transparency is visible in the previews. */
const previewBackground = {
    backgroundImage:
        'repeating-conic-gradient(rgba(128, 128, 128, 0.18) 0% 25%, transparent 0% 50%)',
    backgroundSize: '16px 16px',
};

export const ImagePreview: React.FC<{ label: string; src?: string; caption: string }> = ({ label, src, caption }) => {
    const { token } = theme.useToken();
    return (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{label}</Typography.Text>
            <div
                style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusSM,
                    height: 180,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    ...previewBackground,
                }}
            >
                {src
                    ? <img src={src} alt={label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                    : <Typography.Text type="secondary">…</Typography.Text>}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{caption}</Typography.Text>
        </div>
    );
};
