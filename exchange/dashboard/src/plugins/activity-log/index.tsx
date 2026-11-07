import React, { useEffect, useState } from 'react';
import { ClockCircleOutlined } from '@ant-design/icons';
import { CmsPlugin, FileDto, FileLabelCmp, LayoutContent, MainViewCmp, TopBanner, extractName, useFileBrowsingPersistenceContext, useWorkerClient, lazyComponent } from '@cms-core';
import { ACTIVITY_LOG_EXTENSION, ActivityLogSummary, folderOf, formatClockDuration, loadFolderConfig, summarizeActivityLog } from './activityLog';
import { ProjectColors, assignProjectColors } from './projectColors';
import './ActivityLogLabel.css';

const ActivityLogPanel = lazyComponent(() => import('./ActivityLogPanel').then(m => ({ default: m.ActivityLogPanel })));
const ActivityLogBar = lazyComponent(() => import('./ActivityLogBar').then(m => ({ default: m.ActivityLogBar })));
const TextEditor = lazyComponent(() => import('../text-edit/TextEditor').then(m => ({ default: m.TextEditor })));

const fileLabelCmp: FileLabelCmp = ({ file }) => {
    const client = useWorkerClient();
    const [summary, setSummary] = useState<ActivityLogSummary | null>(null);
    const [colors, setColors] = useState<ProjectColors>({});
    const fileName = extractName(file.path);
    const title = fileName.slice(0, -ACTIVITY_LOG_EXTENSION.length);

    useEffect(() => {
        let cancelled = false;
        setSummary(null);
        client.getFileText(file.path)
            .then(text => !cancelled && setSummary(summarizeActivityLog(text)))
            .catch(() => !cancelled && setSummary(null));
        return () => { cancelled = true; };
    }, [client, file.path, file.lastModified]);

    useEffect(() => {
        let cancelled = false;
        // Unassigned colors match the panel's next write.
        loadFolderConfig(client, folderOf(file.path))
            .then(config => !cancelled && setColors(assignProjectColors(config.projectColors, config.projects)));
        return () => { cancelled = true; };
        // lastModified re-runs this after the panel invalidates the shared config.
    }, [client, file.path, file.lastModified]);

    return <span className="activity-log-label">
        <ClockCircleOutlined />
        <span className="activity-log-label__date">{title}</span>
        {summary && <>
            <span className="activity-log-label__bar">
                <ActivityLogBar date={title} summary={summary} colors={colors} />
            </span>
            <span className="activity-log-label__total">{formatClockDuration(summary.totalMinutes)}</span>
        </>}
    </span>;
};

const MainView: MainViewCmp = () => {
    const { currentFile } = useFileBrowsingPersistenceContext();

    useEffect(() => {
        if (currentFile) document.title = extractName(currentFile.path);
    }, [currentFile]);

    return <>
        <LayoutContent><TextEditor /></LayoutContent>
        <TopBanner />
    </>;
};

const fileConfigFor = (file: FileDto) => file.path.endsWith(ACTIVITY_LOG_EXTENSION) ? {
    fileLabelCmp,
    mainView: MainView,
} : null;

export const plugin = {
    id: 'activity-log',
    fileConfigFor,
    fileExtensions: [ACTIVITY_LOG_EXTENSION],
    toolBars: [{
        id: 'activity-log',
        title: 'Activity',
        icon: <ClockCircleOutlined />,
        render: () => <ActivityLogPanel />,
    }],
} satisfies CmsPlugin;
