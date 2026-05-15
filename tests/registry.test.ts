import { describe, it, expect } from 'vitest';
import { discoverTools, getRegisteredTools, getUptimeSeconds } from '../src/tools/_registry.js';

describe('_registry', () => {
  it('decouvre exactement 9 outils', async () => {
    const tools = await discoverTools();
    expect(tools).toHaveLength(9);
  });

  it('chaque outil a un id, description, category, execute', async () => {
    const tools = await discoverTools();
    for (const tool of tools) {
      expect(typeof tool.id).toBe('string');
      expect(tool.id.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.category).toBe('string');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('les IDs sont uniques', async () => {
    const tools = await discoverTools();
    const ids = tools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getRegisteredTools retourne les outils apres discover', async () => {
    await discoverTools();
    const tools = getRegisteredTools();
    expect(tools.length).toBe(9);
    expect(tools.map((t) => t.id)).toContain('iris-ping-v1');
  });

  it('getUptimeSeconds retourne un nombre >= 0', () => {
    expect(getUptimeSeconds()).toBeGreaterThanOrEqual(0);
  });

  it('contient les 9 outils attendus', async () => {
    const tools = await discoverTools();
    const ids = tools.map((t) => t.id).sort();
    expect(ids).toEqual([
      'fs-list-v1',
      'fs-read-v1',
      'git-commit-v1',
      'git-diff-v1',
      'git-log-v1',
      'git-status-v1',
      'iris-ping-v1',
      'ollama-chat-v1',
      'ollama-list-v1',
    ]);
  });
});
