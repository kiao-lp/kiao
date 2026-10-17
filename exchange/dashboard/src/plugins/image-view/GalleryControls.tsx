import React from 'react';
import { Button, Flex } from 'antd';
import { DeleteOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Tooltip } from '@cms-core';
import type { Gallery } from './useGallery';

/**
 * The picture's place in its folder, the two steps either side of it, and the way out.
 *
 * In the banner rather than over the picture, as the PDF viewer's page counter is: a document's
 * controls live in one place in this CMS, and nothing is drawn on top of what is being looked at.
 * Each has a keyboard equivalent (←, →, Delete) registered by the view.
 */
export const GalleryControls: React.FC<{ gallery: Gallery }> = ({ gallery }) => (
    <Flex align="center" gap={4} className="image-gallery-controls" style={{ marginLeft: 10 }}>
        <Tooltip title="Previous image">
            <Button
                size="small"
                icon={<LeftOutlined />}
                disabled={!gallery.previous}
                onClick={gallery.goPrevious}
                aria-label="Previous image"
            />
        </Tooltip>
        <span
            data-testid="image-counter"
            style={{ whiteSpace: 'nowrap', minWidth: 44, textAlign: 'center' }}
        >
            {gallery.rank || '--'} / {gallery.count || '--'}
        </span>
        <Tooltip title="Next image">
            <Button
                size="small"
                icon={<RightOutlined />}
                disabled={!gallery.next}
                onClick={gallery.goNext}
                aria-label="Next image"
            />
        </Tooltip>
        <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
        <Tooltip title="Delete image">
            <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={gallery.remove}
                aria-label="Delete image"
            />
        </Tooltip>
    </Flex>
);
