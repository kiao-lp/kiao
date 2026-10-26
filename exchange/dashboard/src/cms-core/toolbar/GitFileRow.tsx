import React from 'react';
import { Button, Popconfirm } from 'antd';
import { PlusOutlined, MinusOutlined, RollbackOutlined } from '@ant-design/icons';
import type { GitFile } from 'kiao-worker';
import { Tooltip } from '../ui/Tooltip';

const statusInfo = (file: GitFile, staged: boolean): { letter: string; cls: string } => {
    if (file.conflicted) return { letter: 'C', cls: 'git-st-conflict' };
    if (file.untracked) return { letter: 'U', cls: 'git-st-untracked' };
    const code = staged ? file.index : file.worktree;
    switch (code) {
        case 'M': return { letter: 'M', cls: 'git-st-modified' };
        case 'A': return { letter: 'A', cls: 'git-st-added' };
        case 'D': return { letter: 'D', cls: 'git-st-deleted' };
        case 'R': return { letter: 'R', cls: 'git-st-renamed' };
        case 'C': return { letter: 'C', cls: 'git-st-renamed' };
        default: return { letter: code?.trim() || 'M', cls: 'git-st-modified' };
    }
};

/** One file entry in the staged/changed lists, with stage/unstage/discard actions. */
export const GitFileRow: React.FC<{
    file: GitFile;
    staged: boolean;
    onOpen: (path: string) => void;
    onStage: (path: string) => void;
    onUnstage: (path: string) => void;
    onRevert: (path: string) => void;
}> = ({ file, staged, onOpen, onStage, onUnstage, onRevert }) => {
    const slash = file.path.lastIndexOf('/');
    const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
    const dir = slash >= 0 ? file.path.slice(0, slash) : '';
    const st = statusInfo(file, staged);
    const deleted = (staged ? file.index : file.worktree) === 'D';

    return (
        <div className={`git-file-row${deleted ? ' git-file-deleted' : ''}`} onClick={() => onOpen(file.path)} title={file.path}>
            <span className="git-file-name">{name}</span>
            <span className="git-file-dir">{dir}</span>
            <span className="git-file-actions" onClick={e => e.stopPropagation()}>
                {staged ? (
                    <Tooltip title="Unstage changes">
                        <Button
                            type="text"
                            size="small"
                            icon={<MinusOutlined />}
                            aria-label="Unstage changes"
                            onClick={() => onUnstage(file.path)}
                        />
                    </Tooltip>
                ) : (
                    <>
                        <Popconfirm
                            title="Discard changes?"
                            description="This cannot be undone."
                            okText="Discard"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => onRevert(file.path)}
                        >
                            <Tooltip title="Discard changes">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<RollbackOutlined />}
                                    aria-label="Discard changes"
                                />
                            </Tooltip>
                        </Popconfirm>
                        <Tooltip title="Stage changes">
                            <Button
                                type="text"
                                size="small"
                                icon={<PlusOutlined />}
                                aria-label="Stage changes"
                                onClick={() => onStage(file.path)}
                            />
                        </Tooltip>
                    </>
                )}
            </span>
            <span className={`git-file-badge ${st.cls}`}>{st.letter}</span>
        </div>
    );
};
