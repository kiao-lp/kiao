import React, { useState } from 'react';
import { Button } from 'antd';
import type { ResourceClient } from '../Client';
import type { ReleaseBump } from '../release';
import type { AgenticResourceDto } from '../types';
import { useResourceSource } from '../useResourceSource';
import { ResourceEditor, resourceLabels, useResourceOperations } from './ResourceEditor';
import { ResourceSourceFields } from './ResourceSourceFields';
import styles from './ResourceEditor.module.css';

const manifest = 'apm.yml';

function defaultFile(resource: AgenticResourceDto) {
    const { files } = resource;
    if (resource.kind === 'skill') {
        const skill = files.find(file => file === 'SKILL.md')
            ?? files.find(file => file.startsWith('.apm/skills/') && file.endsWith('/SKILL.md'));
        if (skill) return skill;
    }
    return files.includes(manifest) ? manifest : files[0];
}

interface Props {
    client: ResourceClient;
    project: AgenticResourceDto;
    reloadProjects: () => Promise<AgenticResourceDto[]>;
}

export const ProjectEditorPanel: React.FC<Props> = ({ client, project, reloadProjects }) => {
    const [resource, setResource] = useState<AgenticResourceDto | undefined>(project);
    const [selected, setSelected] = useState<string>();
    const path = resource && (selected && resource.files.includes(selected) ? selected : defaultFile(resource));
    const refresh = async () => {
        const current = (await reloadProjects()).find(one => one.name === project.name && one.kind === project.kind);
        setResource(current);
        return current;
    };
    const source = useResourceSource(client, resource?.name, path, refresh);
    const operations = useResourceOperations(source.flush);
    const { active, run } = operations;
    const busy = operations.busy || source.switching;

    if (!resource) return <p className={styles.hint}>That {resourceLabels[project.kind]} is gone from the store.</p>;

    const operate = async (operation: 'install' | 'publish' | 'pull' | 'push', bump?: ReleaseBump) => {
        await client.resourceOperation(resource.name, operation, { bump });
        const current = await refresh();
        if (path && current?.files.includes(path)) await source.reload();
    };
    const changingVersion = path === manifest && source.file?.content !== source.file?.saved;

    return <ResourceEditor kind={resource.kind} repository={resource.repository || 'Local Git repository'}
        version={resource.version} operations={operations}
        versionPicker={<span>{resource.publishedVersion ? `Draft · Published v${resource.publishedVersion}` : 'Unpublished draft'}</span>}
        onPublish={source.switching || changingVersion || source.error ? undefined : bump => operate('publish', bump)}
        onPull={!source.switching && resource.repository ? () => operate('pull') : undefined}
        extraControls={<>
            <Button disabled={busy || !resource.repository} loading={active?.operation === 'push'}
                onClick={() => void run('push', () => operate('push'))}>Git push</Button>
            <Button disabled={busy} loading={active?.operation === 'install'}
                onClick={() => void run('install', () => operate('install'))}>Install dependencies</Button>
        </>}>
        {!resource.version && <p role="status">Set a major.minor.patch version in apm.yml to publish.</p>}
        <ResourceSourceFields files={resource.files} path={path} select={setSelected} source={source} busy={busy} />
        <span aria-label={`${resourceLabels[resource.kind]} ID`} className={styles.id}>{resource.name}</span>
    </ResourceEditor>;
};
