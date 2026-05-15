import type { IrisTool } from './_types.js';
import { getRegisteredTools, getUptimeSeconds } from './_registry.js';

export const SERVER_VERSION = '0.3.0';

export function buildPingPayload() {
  const tools = getRegisteredTools();
  return {
    version: SERVER_VERSION,
    uptime_seconds: getUptimeSeconds(),
    tools_count: tools.length,
    tools_list: tools.map((t) => t.id),
    timestamp: new Date().toISOString(),
  };
}

export const tool: IrisTool = {
  id: 'iris-ping-v1',
  description:
    'Healthcheck du serveur MCP Iris. Retourne version, uptime, nombre et liste des outils, timestamp.',
  category: 'iris',
  inputSchema: {},
  execute: async () => {
    const payload = buildPingPayload();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  },
};
