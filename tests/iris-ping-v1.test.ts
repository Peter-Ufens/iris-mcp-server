import { describe, it, expect, vi, beforeAll } from 'vitest';

// On doit initialiser le registre avant de tester ping
// car buildPingPayload utilise getRegisteredTools()
describe('iris-ping-v1', () => {
  beforeAll(async () => {
    // Discover tools pour que le registre soit peuple
    const { discoverTools } = await import('../src/tools/_registry.js');
    await discoverTools();
  });

  it('retourne version, uptime, tools_count, tools_list, timestamp', async () => {
    const { buildPingPayload, SERVER_VERSION } = await import('../src/tools/iris-ping-v1.js');
    const p = buildPingPayload();
    expect(p.version).toBe(SERVER_VERSION);
    expect(typeof p.uptime_seconds).toBe('number');
    expect(p.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(p.tools_count).toBe(24);
    expect(p.tools_list).toContain('iris-ping-v1');
    expect(p.tools_list).toContain('ollama-list-v1');
    expect(p.tools_list).toContain('ollama-chat-v1');
    expect(p.tools_list).toContain('fs-read-v1');
    expect(p.tools_list).toContain('fs-list-v1');
    expect(p.tools_list).toContain('git-status-v1');
    expect(p.timestamp).toBeTruthy();
  });

  it('execute retourne le format MCP content', async () => {
    const { tool } = await import('../src/tools/iris-ping-v1.js');
    const result = await tool.execute({});
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.version).toBeTruthy();
    expect(payload.tools_count).toBe(24);
  });
});
