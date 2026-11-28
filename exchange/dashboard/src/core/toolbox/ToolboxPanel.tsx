import React, { useMemo, useState } from 'react';
import { IconButton } from '../ui-foundation/toolbar/IconButton';
import { Alert, Button, Modal, Spin, Switch, Tag } from 'antd';
import { Tooltip } from '../ui-foundation/feedback/Tooltip';
import { InProgressFeedback } from '../ui-foundation/feedback/InProgressFeedback';
import { DeleteOutlined, DownloadOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { Toolbox, ToolboxComponent } from 'kiao-worker';
import { PluginCatalogueEntry } from '../extensibility/assembly';
import { useToolsMenu } from '../dashboard-ui/top-banner/ToolsMenu-ctx';
import { harnessPanelId } from './panelIds';
import { useToolbox, type ToolboxRequest } from './useToolbox';
import { usePlugins } from './usePlugins';
import { KindIcon } from './itemKinds';
import { matchesFilter, NO_FILTER, ToolboxFilter, ToolboxFilterValue } from './ToolboxFilter';
import styles from './Toolbox.module.css';

/** Row order: runtimes, then MCP servers. */
const KIND_ORDER: Record<ToolboxComponent['kind'], number> = { runtime: 0, mcp: 1 };
const requestLabels = { install: 'Starting installation…', uninstall: 'Starting removal…', registration: 'Saving registration…' };

/** Configuration panel: installed runtimes, MCP servers, and store plugins in one list. Entries come only from the catalogue. */
export const ToolboxPanel: React.FC = () => {
    const { toolbox, loading, job, request, busy, error, refresh, install, uninstall, setRegistered } = useToolbox();
    const plugins = usePlugins();
    const [filter, setFilter] = useState<ToolboxFilterValue>(NO_FILTER);

    const components = useMemo(() => (toolbox?.components ?? [])
        .filter(c => matchesFilter(filter, c.kind, c.title, c.role, c.id))
        .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
        [toolbox, filter]);
    const pluginRows = useMemo(
        () => plugins.catalogue.filter(e => matchesFilter(filter, 'plugin', e.title, e.description, e.id)),
        [plugins.catalogue, filter]);

    if (loading && !toolbox) {
        return <div className={styles.center}><Spin /></div>;
    }
    if (error && !toolbox) {
        return (
            <div className={styles.panel}>
                <Alert type="error" showIcon title="The configuration could not be read" description={error} />
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>Try again</Button>
            </div>
        );
    }
    if (!toolbox) return null;

    return (
        <div className={styles.panel} data-testid="toolbox-panel">
            <div className={styles.header}>
                <span className={styles.title}>Configuration</span>
                <IconButton
                    label="Re-read"
                    icon={<ReloadOutlined />}
                    loading={loading} disabled={loading || request !== null} onClick={() => void refresh()}
                />
            </div>

            {request && <InProgressFeedback label={requestLabels[request.kind]} />}
            {error && <Alert type="error" showIcon title="The configuration could not be read" description={error} />}
            {!toolbox.enabled && (
                <Alert
                    type="info"
                    showIcon
                    title="This deployment installs nothing"
                    description="Set KIAO_WORKER_TOOLBOX_PATH to a directory the service may write to, and these rows become installable."
                />
            )}

            {plugins.missing.length > 0 && (
                <Alert
                    type="warning"
                    showIcon
                    title="Named, but not in this build"
                    description={`This store asks for ${plugins.missing.join(', ')}, which this Dashboard was not assembled with.`}
                />
            )}

            {plugins.error && (
                <Alert type="error" showIcon title="The choice could not be saved" description={plugins.error} />
            )}

            {plugins.dirty && !plugins.saving && (
                <div className={styles.notice} data-testid="plugins-reload-notice">
                    Saved. The page has to be reloaded for it to take effect.{' '}
                    <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={() => window.location.reload()}
                        data-testid="plugins-reload"
                    >
                        Reload
                    </Button>
                </div>
            )}

            <ToolboxFilter value={filter} onChange={setFilter} />

            <div className={styles.list}>
                {components.map(component => (
                    <ComponentRow
                        key={component.id}
                        component={component}
                        toolbox={toolbox}
                        busy={busy}
                        request={request}
                        job={job?.state === 'running' ? job : null}
                        onInstall={install}
                        onUninstall={uninstall}
                        onRegister={setRegistered}
                    />
                ))}

                {pluginRows.map(entry => (
                    <PluginRow
                        key={entry.id}
                        entry={entry}
                        checked={plugins.enabled.includes(entry.id)}
                        busy={plugins.saving !== null}
                        saving={plugins.saving === entry.id}
                        onToggle={plugins.toggle}
                    />
                ))}

                {components.length === 0 && pluginRows.length === 0 && (
                    <div className={styles.empty} data-testid="toolbox-empty">Nothing here matches.</div>
                )}
            </div>

            {job && <JobLog job={job} />}
        </div>
    );
};

/** Plugin row: title, description, enable switch. */
const PluginRow: React.FC<{
    entry: PluginCatalogueEntry;
    checked: boolean;
    busy: boolean;
    saving: boolean;
    onToggle: (id: string, on: boolean) => Promise<void>;
}> = ({ entry, checked, busy, saving, onToggle }) => (
    <div className={styles.row} data-testid={`plugin-row-${entry.id}`}>
        <div className={styles.rowHead}>
            <KindIcon kind="plugin" />
            <span className={styles.rowName} title={entry.id}>{entry.title}</span>
            <Switch
                size="small"
                checked={checked}
                disabled={busy}
                loading={saving} aria-busy={saving}
                aria-label={entry.title}
                onChange={value => void onToggle(entry.id, value)}
            />
        </div>
        <div className={styles.rowRole}>{entry.description}</div>
    </div>
);

/** Catalogue row with state and install/register controls. */
const ComponentRow: React.FC<{
    component: ToolboxComponent;
    toolbox: Toolbox;
    busy: boolean;
    request: ToolboxRequest | null;
    job: Toolbox['job'] | null;
    onInstall: (ids: string[]) => Promise<void>;
    onUninstall: (ids: string[]) => Promise<void>;
    onRegister: (id: string, enabled: boolean) => Promise<void>;
}> = ({ component, toolbox, busy, request, job, onInstall, onUninstall, onRegister }) => {
    const [confirming, setConfirming] = useState(false);
    const tools = useToolsMenu();

    const titleOf = (id: string) =>
        toolbox.components.find(c => c.id === id)?.title ?? id;

    // Resolved locally so the confirmation lists dependencies before any request.
    const missing = component.missingRequires ?? [];

    const startInstall = () => {
        if (missing.length === 0) {
            void onInstall([component.id]);
            return;
        }
        setConfirming(true);
    };

    // Broken rows reinstall; they get no enable switch (service refuses unresponsive servers).
    const broken = component.state === 'missing' || component.state === 'unresponsive';
    const canInstall = toolbox.enabled && (component.state === 'available' || broken);
    const canUninstall = toolbox.enabled
        && (component.state === 'installed' || component.state === 'unresponsive')
        && component.channel !== 'bundled' && component.channel !== 'remote';
    const jobAction = request && request.kind !== 'registration' && request.ids.includes(component.id) ? request.kind
        : job?.ids.includes(component.id) ? job.op : undefined;
    const registering = request?.kind === 'registration' && request.id === component.id;
    // Harnesses without an uninstall use the same switch to withdraw from the tab.
    const harness = component.harness;
    const isHarness = Boolean(harness);
    const canRegister = (component.kind === 'mcp' || isHarness)
        && (component.state === 'installed' || component.state === 'present');
    const configuration = harness && canRegister
        ? tools?.items.find(item => item.id === harnessPanelId(harness))
        : undefined;

    return (
        <div className={styles.row} data-testid={`toolbox-row-${component.id}`}>
            <div className={styles.rowHead}>
                <KindIcon kind={component.kind} />
                <span className={styles.rowName} title={component.id}>{component.title}</span>
                <StateTag component={component} />
                {canRegister && (
                    <Tooltip title={harnessSwitchTitle(isHarness, component.registered)}>
                        <Switch
                            size="small"
                            checked={component.registered}
                            disabled={busy}
                            loading={registering} aria-busy={registering}
                            onChange={value => void onRegister(component.id, value)}
                        />
                    </Tooltip>
                )}
                {configuration && tools?.openPanel && (
                    <IconButton
                        label={`Configure ${configuration.panel.label}`}
                        icon={<SettingOutlined />}
                        onClick={() => tools.openPanel?.({ ...configuration.panel, id: configuration.id })}
                    />
                )}
                {canInstall && (
                    <IconButton
                        label={broken ? 'Install it again' : 'Install'}
                        icon={<DownloadOutlined />}
                        disabled={busy} loading={jobAction === 'install'} aria-busy={jobAction === 'install'} onClick={startInstall}
                    />
                )}
                {canUninstall && (
                    <IconButton
                        label="Uninstall"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={busy} loading={jobAction === 'uninstall'} aria-busy={jobAction === 'uninstall'}
                        onClick={() => void onUninstall([component.id])}
                    />
                )}
            </div>

            <div className={styles.rowRole}>{component.role}</div>

            <div className={styles.rowMeta}>
                {component.channel && <span>{component.channel}</span>}
                {component.version && <span>{component.version}</span>}
                {component.tools ? (
                    <span>{component.tools} tools · {Math.round((component.toolBytes ?? 0) / 1024)} kB per request</span>
                ) : null}
            </div>

            {component.reason && <div className={styles.rowReason}>{component.reason}</div>}

            <Modal
                open={confirming}
                title={`Install ${component.title}`}
                okText="Install"
                okButtonProps={{ disabled: busy }}
                onOk={() => { if (!busy) { setConfirming(false); void onInstall([component.id]); } }}
                onCancel={() => setConfirming(false)}
            >
                <p>
                    {component.title} needs {missing.map(titleOf).join(', ')}, which
                    {missing.length === 1 ? ' is' : ' are'} not installed yet.
                    Install {missing.length === 1 ? 'it' : 'them'} too?
                </p>
            </Modal>
        </div>
    );
};

/** Switch tooltip; wording differs for harnesses and servers. */
const harnessSwitchTitle = (isHarness: boolean, registered: boolean): string => {
    if (isHarness) return registered ? 'Offered in the Conversations tab' : 'Not offered in the Conversations tab';
    return registered ? 'Handed to every turn' : 'Not handed to turns';
};

/** The badge that says where a row stands, and nothing more than that. */
const StateTag: React.FC<{ component: ToolboxComponent }> = ({ component }) => {
    switch (component.state) {
        case 'installed':
            return <Tag color="green">installed</Tag>;
        case 'present':
            return <Tag color="blue">on this machine</Tag>;
        case 'available':
            return null;
        case 'blocked':
            return <Tag color="orange">blocked</Tag>;
        case 'missing':
            return <Tag color="red">missing</Tag>;
        // Installed and dead. Said in the row rather than only in the job log, because the log
        // belongs to one install and this is the state the row is in from then on.
        case 'unresponsive':
            return <Tag color="red">does not answer</Tag>;
        case 'unavailable':
        default:
            return <Tag>not here</Tag>;
    }
};

/** The install, as it runs: what it is doing, and everything the tools have said so far. */
const JobLog: React.FC<{ job: NonNullable<Toolbox['job']> }> = ({ job }) => (
    <>
        <div className={styles.logHead}>
            {job.state === 'running' && <Spin size="small" />}
            <span>
                {job.op === 'install' ? 'Installing' : 'Removing'} {job.ids.join(', ')}
                {job.state === 'done' && ' — done'}
                {job.state === 'failed' && ' — failed'}
            </span>
        </div>
        {job.error && <Alert type="error" showIcon title={job.error} />}
        <pre className={styles.log} data-testid="toolbox-job-log">{job.log}</pre>
    </>
);
