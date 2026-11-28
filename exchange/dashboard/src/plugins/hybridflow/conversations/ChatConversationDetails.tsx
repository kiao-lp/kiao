import { useMemo } from 'react';
import type { FC, ReactNode } from 'react';
import { dcmsLinkOf } from 'kiao-worker';
import type { HarnessConversation, HarnessConversationDetail, HarnessOptionsEntry } from 'kiao-worker';
import { localizeNoticeDateTimes } from '@kiao-dashboard-kit/date-time';

const Detail: FC<{ label: string; children?: ReactNode }> = ({ label, children }) => (
    children == null || children === '' ? null : <><dt>{label}</dt><dd>{children}</dd></>
);

const DetailGroup: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
    <section>
        <h4>{title}</h4>
        <dl>{children}</dl>
    </section>
);

const code = (value?: string) => value ? <code>{value}</code> : undefined;
const namedCode = (value: string, name?: string) =>
    name && name !== value ? <>{name} · {code(value)}</> : code(value);
const date = (value?: string) => value
    ? <time dateTime={value} title={value}>{localizeNoticeDateTimes(value)}</time>
    : undefined;

export const ChatConversationDetails: FC<{
    conversation: HarnessConversation;
    detail: HarnessConversationDetail | null;
    harnessOptions: HarnessOptionsEntry;
}> = ({ conversation, detail, harnessOptions }) => {
    const agent = conversation.agentVersion;
    const agentName = agent?.name || agent?.agentId;
    const release = agent?.draftId ? 'Local draft' : agent?.tag || (agent?.version && `v${agent.version}`);
    const harnessName = harnessOptions.label || conversation.harness;
    const profile = harnessOptions.profiles?.find(entry => entry.id === conversation.profileId);
    const model = conversation.model || agent?.resolvedModel;
    const modelOption = (profile?.models ?? harnessOptions.models).find(entry => entry.value === model);
    const effort = (modelOption?.efforts ?? harnessOptions.efforts).find(entry => entry.value === conversation.effort);
    const permission = harnessOptions.permissionModes.find(entry => entry.value === conversation.permissionMode);
    const latestTurn = useMemo(
        () => detail?.messages.reduce((latest, entry) => entry.turnId || latest, ''),
        [detail],
    );
    const locations = detail?.locations;
    const preview = [agentName, release, harnessName, modelOption?.label || model].filter(Boolean).join(' · ');

    return (
        <details className="chat-conversation-details" data-testid="conversation-details">
            <summary>
                <span>Conversation details</span>
                <span className="chat-conversation-details__preview" title={preview}>{preview}</span>
            </summary>
            <div className="chat-conversation-details__body">
                <DetailGroup title="Agent">
                    <Detail label="Name">{agentName || 'Agent snapshot unavailable'}</Detail>
                    <Detail label="Agent ID">{code(agent?.agentId)}</Detail>
                    <Detail label="Version">{release}</Detail>
                    <Detail label="Published">{agent?.draftId ? undefined : date(agent?.publishedAt)}</Detail>
                    <Detail label="Repository">{code(agent?.repository)}</Detail>
                    <Detail label="Commit">{code(agent?.commit)}</Detail>
                    <Detail label="Draft ID">{code(agent?.draftId)}</Detail>
                    <Detail label="Dependency lock">{code(agent?.lockDigest)}</Detail>
                    <Detail label="Description">{agent?.description}</Detail>
                </DetailGroup>
                <DetailGroup title="Execution defaults">
                    <Detail label="Harness">{namedCode(conversation.harness, harnessName)}</Detail>
                    <Detail label="Model">{model ? namedCode(model, modelOption?.label) : 'Harness default'}</Detail>
                    <Detail label="Profile">{conversation.profileId && namedCode(conversation.profileId, profile?.name)}</Detail>
                    <Detail label="Reasoning effort">{effort?.label || conversation.effort || 'Harness default'}</Detail>
                    <Detail label="Thinking">{conversation.thinking ? 'On' : 'Off'}</Detail>
                    <Detail label="Permissions">{permission?.label || conversation.permissionMode}</Detail>
                </DetailGroup>
                <DetailGroup title="Conversation">
                    <Detail label="Conversation ID">{code(conversation.id)}</Detail>
                    <Detail label="Harness session">
                        {code(conversation.sessionId) ?? (conversation.sessionLost
                            ? 'Lost · starts again on the next turn'
                            : 'Awaiting a session')}
                    </Detail>
                    <Detail label="Latest turn ID">{code(latestTurn)}</Detail>
                    <Detail label="Created">{date(conversation.createdAt)}</Detail>
                    <Detail label="Forked from">{code(conversation.forkedFrom)}</Detail>
                    <Detail label="Fork message ID">{code(conversation.forkedFromMessage)}</Detail>
                </DetailGroup>
                <DetailGroup title="Files on the worker">
                    <Detail label="Working folder (DCMS link)">{code(dcmsLinkOf(conversation.folder))}</Detail>
                    <Detail label="Working directory">{code(locations?.workingDirectory)}</Detail>
                    <Detail label="Conversation directory">{code(locations?.conversationDirectory)}</Detail>
                    <Detail label="Metadata">{code(locations?.metadataFile)}</Detail>
                    <Detail label="Transcript">{code(locations?.transcriptFile)}</Detail>
                    <Detail label="Turn traces">{code(locations?.turnTracesDirectory)}</Detail>
                    <Detail label="Raw protocol tracing">{conversation.traceStream ? 'On' : 'Off'}</Detail>
                    <Detail label="Attachment storage">{code(locations?.attachmentsDirectory)}</Detail>
                </DetailGroup>
                {agent?.instructions && (
                    <section className="chat-conversation-details__instructions">
                        <h4>Standing instructions</h4>
                        <p>{agent.instructions}</p>
                    </section>
                )}
            </div>
        </details>
    );
};
