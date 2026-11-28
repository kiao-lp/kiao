import { forwardRef, type ReactNode } from 'react';
import { CopyButton } from '../clipboard/CopyButton';
import { CopySvgButton } from '../clipboard/CopySvgButton';
import './BlockFrame.css';

interface BlockFrameProps {
    source: string;
    variant?: 'code' | 'diagram';
    getSvg?: () => string | null | Promise<string | null>;
    actions?: ReactNode;
    children: ReactNode;
}

export const BlockFrame = forwardRef<HTMLDivElement, BlockFrameProps>(
    ({ source, variant = 'code', getSvg, actions, children }, ref) => (
        <div ref={ref} className={variant === 'diagram' ? 'code-block-wrapper diagram-block' : 'code-block-wrapper'}>
            <div className="code-block-actions">
                <CopyButton className="code-copy-btn" code={source} />
                {getSvg && <CopySvgButton className="code-copy-btn svg-copy-btn" getSvg={getSvg} />}
                {actions}
            </div>
            <div className="code-block-content">{children}</div>
        </div>
    ),
);

BlockFrame.displayName = 'BlockFrame';
