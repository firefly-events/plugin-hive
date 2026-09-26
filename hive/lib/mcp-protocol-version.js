// Single-sourced protocol versions for both hand-rolled MCP servers
// (multica-story-dispatch/mcp-tools.mjs, openai-image-mcp-server.js).
//
// MCP requires a server to echo a requested version only when it supports that
// version. Otherwise the server responds with a version it does support. Keep
// the newest published version first and retain older versions that these
// tools-only stdio servers remain compatible with.
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);

export const MCP_PROTOCOL_VERSION = MCP_SUPPORTED_PROTOCOL_VERSIONS[0];

export function negotiateMcpProtocolVersion(requestedVersion) {
  return MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
    ? requestedVersion
    : MCP_PROTOCOL_VERSION;
}
