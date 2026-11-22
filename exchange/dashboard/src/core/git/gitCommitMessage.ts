/** Default commit message: a `YYMMDDhhmm` timestamp, shared by the Git panel and
 *  the close-time auto-commit in {@link GitSyncMonitor}. */
export const timestampCommitMessage = (): string => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
};
