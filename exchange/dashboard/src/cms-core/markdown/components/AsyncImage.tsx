import React, { useEffect, useState } from 'react';

export interface AsyncImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    resolveImage?: (src: string) => Promise<string> | string;
}

export const AsyncImage: React.FC<AsyncImageProps> = ({ src, resolveImage, ...props }) => {
    const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (!src) {
            setResolvedSrc(undefined);
            return;
        }

        if (resolveImage) {
            Promise.resolve(resolveImage(src))
                .then(setResolvedSrc)
                .catch(err => {
                    console.error('Failed to resolve image', src, err);
                    setResolvedSrc(src);
                });
        } else {
            setResolvedSrc(src);
        }
    }, [src, resolveImage]);

    if (resolvedSrc === undefined && resolveImage) return <span>Loading image...</span>;

    return <img src={resolvedSrc || src} {...props} />;
};
