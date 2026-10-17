import React, { useEffect, useState } from 'react';
import { Tooltip } from '../ui/Tooltip';
import { useWorkerClient } from 'src/cms-core/files/service/ui';
import { DiskUsage, WorkerClient } from 'src/cms-core/files/service';

export const DiskUsageCmp: React.FC = () => {
    const workerClient = useWorkerClient();
    const [diskUsage, setDiskUsage] = useState<DiskUsage | null>(null);

    useEffect(() => {
        const fetchDiskUsage = async () => {
            try {
                const fs = workerClient as WorkerClient;
                if (fs.getDiskUsage) {
                    const usage = await fs.getDiskUsage();
                    setDiskUsage(usage);
                }
            } catch (e) {
                console.error('Failed to fetch disk usage', e);
            }
        };

        fetchDiskUsage();
    }, [workerClient]);

    if (!diskUsage) return null;

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const usedSpace = diskUsage.totalSpace - diskUsage.freeSpace;
    const usedPercentage = diskUsage.totalSpace > 0
        ? Math.round((usedSpace / diskUsage.totalSpace) * 100)
        : 0;

    return (
        <Tooltip title={`${formatBytes(usedSpace)} / ${formatBytes(diskUsage.totalSpace)}`}>
            <span style={{ fontSize: '0.9em', opacity: 0.8, whiteSpace: 'nowrap' }}>
                {usedPercentage}%
            </span>
        </Tooltip>
    );
};
