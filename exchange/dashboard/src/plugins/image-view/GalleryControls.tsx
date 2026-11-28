import React from 'react';
import { IconButton } from '@kiao-dashboard-core';
import { Flex } from 'antd';
import { DeleteOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { Gallery } from './useGallery';

/** Shown in the banner, not over the image. Keyboard equivalents: ←, →, Delete. */
export const GalleryControls: React.FC<{ gallery: Gallery }> = ({ gallery }) => (
    <Flex align="center" gap={4} className="image-gallery-controls" style={{ marginLeft: 10 }}>
        <IconButton
            label="Previous image"
            type="default"
            icon={<LeftOutlined />}
            disabled={!gallery.previous}
            onClick={gallery.goPrevious}
        />
        <span
            data-testid="image-counter"
            style={{ whiteSpace: 'nowrap', minWidth: 44, textAlign: 'center' }}
        >
            {gallery.rank || '--'} / {gallery.count || '--'}
        </span>
        <IconButton
            label="Next image"
            type="default"
            icon={<RightOutlined />}
            disabled={!gallery.next}
            onClick={gallery.goNext}
        />
        <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
        <IconButton
            label="Delete image"
            type="default"
            danger
            icon={<DeleteOutlined />}
            onClick={gallery.remove}
        />
    </Flex>
);
