import { WorkerClient } from 'kiao-worker';

// The endpoint a file action runs through.
const ACTION_RUN_PATH = "/actions/run";

// Builds the WorkerClient for /api/files.
export const createWorkerClient = (
  getToken?: () => string | undefined,
  freshenToken?: () => Promise<void>,
): WorkerClient => {
  const baseUrl = new URL(`/api/files`, window.location.origin).toString().replace(/\/$/, "");
  if (!getToken) {
    return new WorkerClient(baseUrl);
  }
  const authHeaders = (): Record<string, string> => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  return new WorkerClient(
    baseUrl,
    async (url, init) => {
      if (freshenToken && String(url).includes(ACTION_RUN_PATH)) await freshenToken();
      return fetch(url, { ...init, headers: { ...init?.headers, ...authHeaders() } });
    },
    authHeaders,
  );
};
