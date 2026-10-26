import React from 'react';
import { Select, message } from 'antd';
import { Tooltip } from '../ui/Tooltip';
import {
    FileOutlined,
    FileTextOutlined,
    FileMarkdownOutlined,
    TableOutlined,
    BookOutlined,
    DeleteOutlined,
    PlusOutlined,
} from '@ant-design/icons';
import { FileCompanion } from 'kiao-worker';
import { extractName } from 'src/cms-core/files/service';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { useFileBrowsingPersistenceContext } from '../files/core/FileBrowsingPersistence-ctx';
import { useRefreshFileList } from '../files/core/CurrentFileList-ctx';
import { resolveInternalLink } from '../lib/internal-links';

type SuffixMeta = { icon: React.ReactNode; title: string };

const SUFFIX_META: Record<string, SuffixMeta> = {
    '': { icon: <FileOutlined />, title: 'Main file' },
    '.index.txt': { icon: <FileTextOutlined />, title: 'Plain-text index' },
    '.index.md': { icon: <FileMarkdownOutlined />, title: 'Markdown index' },
    '.index.csv': { icon: <TableOutlined />, title: 'Spreadsheet index (CSV)' },
    '.blog.md': { icon: <BookOutlined />, title: 'Backlog' },
};

const metaFor = (suffix: string): SuffixMeta =>
    SUFFIX_META[suffix] ?? { icon: <FileOutlined />, title: suffix || 'File' };

const buildUrl = (folderPath: string, name: string): string =>
    resolveInternalLink(folderPath ? `/${folderPath}/${name}` : `/${name}`);

export const CompanionSwitch: React.FC = () => {
    const { currentFile, currentPath } = useFileBrowsingPersistenceContext();
    const client = useWorkerClient();
    // A companion is a file of the browsed folder: creating or deleting one is a change of the
    // store like any other, and the views drawing it have no other way of hearing about it.
    const refreshFileList = useRefreshFileList();
    const [overrides, setOverrides] = React.useState<Record<string, FileCompanion>>({});

    const baseCompanions = currentFile?.companions ?? [];
    if (baseCompanions.length === 0) return null;

    const companions = baseCompanions.map((c) => overrides[c.name] ?? c);
    const currentName = currentFile ? extractName(currentFile.path) : '';

    const openInNewTab = (name: string) => {
        window.open(buildUrl(currentPath, name), '_blank');
    };

    const handleCreateAndOpen = async (companion: FileCompanion) => {
        try {
            await client.upload(currentPath, '', { filename: companion.name });
            refreshFileList();
            setOverrides((prev) => ({ ...prev, [companion.name]: { ...companion, exists: true } }));
            openInNewTab(companion.name);
        } catch (e) {
            message.error(`Failed to create ${companion.name}`);
        }
    };

    const handleDelete = async (companion: FileCompanion) => {
        const confirmMsg =
            companion.suffix === ''
                ? `Delete the main file "${companion.name}" and all its companions?`
                : `Delete companion "${companion.name}"?`;
        if (!window.confirm(confirmMsg)) return;
        const fullPath = currentPath ? `${currentPath}/${companion.name}` : companion.name;
        try {
            await client.delete(fullPath);
            refreshFileList();
            setOverrides((prev) => ({ ...prev, [companion.name]: { ...companion, exists: false } }));
            message.success(`Deleted ${companion.name}`);
        } catch (e) {
            message.error(`Failed to delete ${companion.name}`);
        }
    };

    const handleSelect = (name: string) => {
        const companion = companions.find((c) => c.name === name);
        if (!companion) return;
        if (companion.name === currentName) return;
        if (companion.exists) {
            openInNewTab(companion.name);
        } else {
            void handleCreateAndOpen(companion);
        }
    };

    const options = companions.map((c) => {
        const { icon, title } = metaFor(c.suffix);
        return {
            value: c.name,
            label: (
                <Tooltip title={title} placement="left">
                    <span style={{ opacity: c.exists ? 1 : 0.4 }}>{icon}</span>
                </Tooltip>
            ),
            companion: c,
        };
    });

    return (
        <Select
            value={currentName}
            onChange={handleSelect}
            options={options}
            variant="borderless"
            size="small"
            suffixIcon={null}
            popupMatchSelectWidth={false}
            style={{ width: 'auto' }}
            optionRender={(option) => {
                const c = (option.data as { companion: FileCompanion }).companion;
                const { icon, title } = metaFor(c.suffix);
                return (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            opacity: c.exists ? 1 : 0.5,
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {icon}
                            <span>{title}</span>
                            {!c.exists && (
                                <Tooltip title="Click to create">
                                    <PlusOutlined style={{ fontSize: 10 }} />
                                </Tooltip>
                            )}
                        </span>
                        {c.exists && (
                            <Tooltip title={`Delete ${c.name}`}>
                                <DeleteOutlined
                                    style={{ color: '#c00', cursor: 'pointer' }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void handleDelete(c);
                                    }}
                                />
                            </Tooltip>
                        )}
                    </div>
                );
            }}
        />
    );
};
