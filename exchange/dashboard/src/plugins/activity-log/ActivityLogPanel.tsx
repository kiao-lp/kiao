import React, { useEffect, useMemo, useState } from 'react';
import { AutoComplete, Button, Checkbox, Input, message } from 'antd';
import { CheckOutlined, DownloadOutlined } from '@ant-design/icons';
import { useFileBrowsingPersistenceContext, useFileSelection, useWorkerClient, useRefreshFileList } from '@cms-core';
import { ACTIVITY_LOG_EXTENSION, ActivityLogConfig, EMPTY_CONFIG, TIMESHEET_END, TIMESHEET_START, appendJsonl, buildTimesheetCsv, collectActivityEntries, configPathFor, dateFromLogPath, durationInMinutes, formatBookedDuration, invalidateFolderConfig, logPathFor, readConfig, today, upsertTemplate } from './activityLog';
import { assignProjectColors } from './projectColors';
import { downloadTextFile } from './download';
import './ActivityLogPanel.css';

export const ActivityLogPanel: React.FC = () => {
    const client = useWorkerClient();
    const refreshFileList = useRefreshFileList();
    const { currentPath } = useFileBrowsingPersistenceContext();
    const { primary: selectedPath } = useFileSelection();
    const [date, setDate] = useState(today);
    const [project, setProject] = useState('');
    const [duration, setDuration] = useState('');
    const [description, setDescription] = useState('');
    const [comment, setComment] = useState('');
    const [saveTemplate, setSaveTemplate] = useState(false);
    const [config, setConfig] = useState<ActivityLogConfig>(EMPTY_CONFIG);
    const [loadingConfig, setLoadingConfig] = useState(false);
    const [saving, setSaving] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [resourceUnit, setResourceUnit] = useState('');
    const [resourceName, setResourceName] = useState('');

    useEffect(() => {
        let cancelled = false;
        setLoadingConfig(true);
        setConfig(EMPTY_CONFIG);
        client.getFileText(configPathFor(currentPath))
            .then(text => !cancelled && setConfig(readConfig(text)))
            // A missing config is the normal first-run state.
            .catch(() => !cancelled && setConfig(EMPTY_CONFIG))
            .finally(() => !cancelled && setLoadingConfig(false));
        return () => { cancelled = true; };
    }, [client, currentPath]);

    useEffect(() => {
        if (!selectedPath) return;
        const selectedDate = dateFromLogPath(selectedPath);
        if (selectedDate) setDate(selectedDate);
    }, [selectedPath]);

    useEffect(() => {
        setResourceUnit(config.resourceUnit ?? '');
        setResourceName(config.resourceName ?? '');
    }, [config.resourceUnit, config.resourceName]);

    const projectOptions = useMemo(() => config.projects.map(value => ({ value })), [config.projects]);
    const descriptionOptions = useMemo(() => config.templates.map(template => ({ value: template.description })), [config.templates]);

    const loadTemplate = (description: string) => {
        const template = config.templates.find(item => item.description === description);
        if (!template) return;
        if (template.project) setProject(template.project);
        if (template.durationMinutes) setDuration(formatBookedDuration(template.durationMinutes));
        setDescription(template.description);
    };

    const save = async () => {
        const cleanedProject = project.trim();
        const cleanedDescription = description.trim();
        const cleanedDuration = duration.trim();
        const minutes = durationInMinutes(cleanedDuration);
        if (!date || !cleanedProject || minutes === null) {
            message.error('Enter a date, project, and a duration such as 1h 30m.');
            return;
        }

        setSaving(true);
        try {
            const logPath = logPathFor(currentPath, date);
            let existing = '';
            try {
                existing = await client.getFileText(logPath);
            } catch {
                // The log file is created by update() when it does not exist.
            }
            await client.update(logPath, appendJsonl(existing, {
                date,
                project: cleanedProject,
                durationMinutes: minutes,
                ...(cleanedDescription ? { description: cleanedDescription } : {}),
                ...(comment.trim() ? { comment: comment.trim() } : {}),
            }));

            const projects = [...new Set([...config.projects, cleanedProject])].sort((a, b) => a.localeCompare(b));
            const templates = saveTemplate && cleanedDescription
                ? upsertTemplate(config.templates, { project: cleanedProject, durationMinutes: minutes, description: cleanedDescription })
                : config.templates;
            // Pins the bar colour of every project that has none yet, this one
            // included. Configurations written before the bars existed are
            // filled in here, once, and never shift again afterwards.
            const projectColors = assignProjectColors(config.projectColors, projects);
            const projectsChanged = projects.length !== config.projects.length || !config.projects.includes(cleanedProject);
            const templatesChanged = JSON.stringify(templates) !== JSON.stringify(config.templates);
            const colorsChanged = JSON.stringify(projectColors) !== JSON.stringify(config.projectColors);
            if (projectsChanged || templatesChanged || colorsChanged) {
                const next = { projects, templates, projectColors, resourceUnit: config.resourceUnit, resourceName: config.resourceName };
                await client.update(configPathFor(currentPath), JSON.stringify(next, null, 2) + '\n');
                setConfig(next);
                invalidateFolderConfig();
            }
            await refreshFileList();
            setDuration('');
            setDescription('');
            setComment('');
            message.success('Activity logged.');
        } catch (error) {
            message.error(error instanceof Error ? `Could not save activity: ${error.message}` : 'Could not save activity.');
        } finally {
            setSaving(false);
        }
    };

    const downloadTimesheet = async () => {
        setDownloading(true);
        try {
            const entries = await collectActivityEntries(client, currentPath);
            if (entries.length === 0) {
                message.warning('No activity entries found in this folder.');
                return;
            }
            const unit = resourceUnit.trim();
            const name = resourceName.trim();
            if (unit !== (config.resourceUnit ?? '') || name !== (config.resourceName ?? '')) {
                const next = {
                    ...config,
                    ...(unit ? { resourceUnit: unit } : { resourceUnit: undefined }),
                    ...(name ? { resourceName: name } : { resourceName: undefined }),
                };
                await client.update(configPathFor(currentPath), JSON.stringify(next, null, 2) + '\n');
                setConfig(next);
                invalidateFolderConfig();
            }
            const csv = buildTimesheetCsv(entries, { resourceUnit: unit, resourceName: name });
            downloadTextFile(csv, `Timesheets_${TIMESHEET_START}_${TIMESHEET_END}.csv`, 'text/csv');
            message.success('Timesheet CSV downloaded.');
        } catch (error) {
            message.error(error instanceof Error ? `Could not download timesheet: ${error.message}` : 'Could not download timesheet.');
        } finally {
            setDownloading(false);
        }
    };

    return <div className="activity-log-panel">
        <label>Date
            <Input type="date" value={date} onChange={event => setDate(event.target.value)} disabled={saving} />
        </label>
        <label>Project
            <AutoComplete value={project} options={projectOptions} onChange={setProject} disabled={saving || loadingConfig}
                placeholder="Choose or type a project" filterOption={(input, option) =>
                    String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())} />
        </label>
        <label>Time spent
            <Input value={duration} onChange={event => setDuration(event.target.value)} disabled={saving}
                placeholder="e.g. 1h 30m or 01:30" onPressEnter={save} />
        </label>
        <label>What was done <span>(optional)</span>
            <AutoComplete value={description} options={descriptionOptions} onChange={setDescription} onSelect={loadTemplate}
                disabled={saving || loadingConfig} placeholder="Choose or type what was done" filterOption={(input, option) =>
                    String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())} />
        </label>
        <label>Comment <span>(optional)</span>
            <Input.TextArea value={comment} onChange={event => setComment(event.target.value)} disabled={saving}
                autoSize={{ minRows: 2, maxRows: 8 }} placeholder="Long, multiline notes about this entry" />
        </label>
        <label>
            <Checkbox checked={saveTemplate} onChange={event => setSaveTemplate(event.target.checked)}
                disabled={saving || loadingConfig || !description.trim()}>
                Save as reusable template
            </Checkbox>
        </label>
        <Button type="primary" icon={<CheckOutlined />} onClick={save} loading={saving} block>Log activity</Button>
        <label>Resource unit <span>(timesheet)</span>
            <Input value={resourceUnit} onChange={event => setResourceUnit(event.target.value)} disabled={downloading}
                placeholder="e.g. ITDS" />
        </label>
        <label>Resource name <span>(timesheet)</span>
            <Input value={resourceName} onChange={event => setResourceName(event.target.value)} disabled={downloading}
                placeholder="e.g. Alex Example" />
        </label>
        <Button icon={<DownloadOutlined />} onClick={downloadTimesheet} loading={downloading} block>Download timesheet CSV</Button>
        <small>Saved as <code>{date || 'YYYY-MM-DD'}{ACTIVITY_LOG_EXTENSION}</code> in this folder.</small>
    </div>;
};
