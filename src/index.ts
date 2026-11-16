/**
 * Resolve MCP - Main entry point
 * Model Context Protocol server for DaVinci Resolve Studio
 */

export { ResolveMCPServer } from './server/mcp-server.js';
export { bridgeClient } from './bridge/bridge-client.js';
export { approvalManager } from './utils/approval.js';
export * from './types/index.js';