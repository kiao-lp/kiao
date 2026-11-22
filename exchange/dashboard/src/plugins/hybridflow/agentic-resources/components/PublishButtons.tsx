import React from 'react';
import { Button, Space } from 'antd';
import { nextReleaseVersion, releaseBumps, type ReleaseBump } from '../release';

export const PublishButtons: React.FC<{
    version?: string;
    disabled: boolean;
    publishing?: ReleaseBump | null;
    onPublish: (bump: ReleaseBump) => void;
}> = ({ version, disabled, publishing, onPublish }) => (
    <Space wrap>
        {releaseBumps.map(bump => (
            <Button key={bump} type={bump === 'patch' ? 'primary' : 'default'}
                disabled={disabled} loading={publishing === bump} onClick={() => onPublish(bump)}>
                {version ? `Publish ${bump} v${nextReleaseVersion(version, bump)}` : `Publish ${bump}`}
            </Button>
        ))}
    </Space>
);
