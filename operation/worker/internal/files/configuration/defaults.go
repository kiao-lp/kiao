package configuration

// Reads are latency-bound, especially on host bind mounts; workers deliberately exceed
// CPU count. Override with KIAO_WORKER_LINK_FIX_WORKERS.
const DefaultLinkFixWorkers = 16
