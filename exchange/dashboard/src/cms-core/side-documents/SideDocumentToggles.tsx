import React from 'react';
import { Button } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import { useSideDocuments } from './SideDocuments-ctx';

/**
 * One switch per side document the open document may be shown with — the third toggle beside
 * "Hide Editor" and "Hide Preview" in the markdown tool bar. Nothing at all when no plugin has
 * anything to offer this file.
 */
export const SideDocumentToggles: React.FC = () => {
    const { offered, toggle, creating } = useSideDocuments();

    if (offered.length === 0) return null;

    return (
        <>
            {offered.map(({ declaration, open }) => (
                <Tooltip key={declaration.id} title={`${open ? 'Hide' : 'Show'} ${declaration.title}`}>
                    <Button
                        type="text"
                        size="small"
                        icon={declaration.icon}
                        loading={creating === declaration.id}
                        style={{ color: open ? 'var(--link)' : undefined, opacity: open ? 1 : 0.5 }}
                        onClick={() => toggle(declaration.id)}
                        aria-label={`${open ? 'Hide' : 'Show'} ${declaration.title}`}
                    />
                </Tooltip>
            ))}
        </>
    );
};
