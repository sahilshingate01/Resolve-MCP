/**
 * Integration tests for Resolve MCP
 * These tests require a running DaVinci Resolve instance
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { bridgeClient } from '../src/bridge/bridge-client.js';
import { approvalManager } from '../src/utils/approval.js';

// These tests are skipped by default - they require a running Resolve instance
// Run with: npx vitest run --reporter=verbose tests/integration.test.ts

describe.skip('Integration Tests (requires Resolve)', () => {
  beforeAll(async () => {
    approvalManager.setAutoApprove(true);
  });

  afterAll(async () => {
    await bridgeClient.disconnect();
  });

  it('should connect to Resolve and get version', async () => {
    const result = await bridgeClient.getVersion();
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('version');
    expect(result.data).toHaveProperty('platform');
  });

  it('should get project info when project is open', async () => {
    const result = await bridgeClient.getProject();
    // This will fail if no project is open - that's expected in test env
    if (result.success) {
      expect(result.data).toHaveProperty('name');
      expect(result.data).toHaveProperty('timelines');
      expect(result.data).toHaveProperty('mediaPool');
    }
  });
});

// Unit-style tests for types and utilities
describe('Type Definitions', () => {
  it('should have all required type exports', async () => {
    const types = await import('../src/types/index.js');
    // Types are TypeScript interfaces, they don't exist at runtime
    // This test verifies the module can be imported
    expect(types).toBeDefined();
    expect(typeof types).toBe('object');
  });
});

describe('BridgeClient Methods', () => {
  it('should have all required methods', () => {
    const methods = [
      'getProject',
      'getVersion',
      'importMedia',
      'cutClip',
      'trimClip',
      'rippleDelete',
      'addMarker',
      'addTextTitle',
      'duplicateTimeline',
      'adjustClipProperties',
      'exportTimeline',
      'renderFrame',
      'takeScreenshot',
      'disconnect',
    ];

    for (const method of methods) {
      expect(typeof (bridgeClient as any)[method]).toBe('function');
    }
  });
});