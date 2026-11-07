// Public subpath for external MCP packages to bundle.
export { startServer } from './server.js';
export { guard, ok, type ToolResult } from './tools-common.js';
export type { Config } from './config.js';
export type { WorkerClient } from './files.js';
// Share the client's error class so instanceof works across the API boundary.
export { WorkerError } from './files.js';
export type { ActionResult, Document, FileDto, SearchResponse, SearchResult } from './types.js';
// Consumers need the runner's SDK type; another SDK copy is nominally distinct.
export type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
