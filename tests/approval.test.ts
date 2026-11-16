/**
 * Tests for Approval System
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { approvalManager, createApprovalRequest, withApproval } from '../src/utils/approval.js';
import { ApprovalRequest, ApprovalResponse, ToolResult } from '../src/types/index.js';

describe('ApprovalManager', () => {
  beforeEach(() => {
    approvalManager.clearCache();
    approvalManager.setAutoApprove(false);
    approvalManager.setHandler(null);
  });

  afterEach(() => {
    approvalManager.clearCache();
  });

  it('should identify dangerous tools', () => {
    expect(approvalManager.isDangerousTool('cut_clip')).toBe(true);
    expect(approvalManager.isDangerousTool('trim_clip')).toBe(true);
    expect(approvalManager.isDangerousTool('ripple_delete')).toBe(true);
    expect(approvalManager.isDangerousTool('get_project_info')).toBe(false);
    expect(approvalManager.isDangerousTool('list_timelines')).toBe(false);
  });

  it('should identify high risk tools', () => {
    expect(approvalManager.isHighRiskTool('ripple_delete')).toBe(true);
    expect(approvalManager.isHighRiskTool('trim_clip')).toBe(true);
    expect(approvalManager.isHighRiskTool('cut_clip')).toBe(false);
  });

  it('should return correct risk levels', () => {
    expect(approvalManager.getRiskLevel('ripple_delete')).toBe('high');
    expect(approvalManager.getRiskLevel('trim_clip')).toBe('high');
    expect(approvalManager.getRiskLevel('cut_clip')).toBe('medium');
    expect(approvalManager.getRiskLevel('get_project_info')).toBe('low');
  });

  it('should create approval requests', () => {
    const request = createApprovalRequest('cut_clip', 'Cut clip at frame 100', { clipId: '123', cutFrame: 100 });

    expect(request.tool).toBe('cut_clip');
    expect(request.description).toBe('Cut clip at frame 100');
    expect(request.params).toEqual({ clipId: '123', cutFrame: 100 });
    expect(request.riskLevel).toBe('medium');
    expect(request.id).toBeDefined();
    expect(request.timestamp).toBeDefined();
  });

  it('should auto-approve when enabled', async () => {
    approvalManager.setAutoApprove(true);

    const request: ApprovalRequest = {
      id: 'test-1',
      tool: 'cut_clip',
      description: 'Test cut',
      params: { clipId: '123', cutFrame: 100 },
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    const response = await approvalManager.requestApproval(request);
    expect(response.approved).toBe(true);
    expect(response.requestId).toBe('test-1');
  });

  it('should deny by default without handler', async () => {
    const request: ApprovalRequest = {
      id: 'test-2',
      tool: 'cut_clip',
      description: 'Test cut',
      params: { clipId: '123', cutFrame: 100 },
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    const response = await approvalManager.requestApproval(request);
    expect(response.approved).toBe(false);
    expect(response.reason).toBe('No approval handler configured');
  });

  it('should use custom handler', async () => {
    const mockHandler = vi.fn().mockResolvedValue({ requestId: 'test-3', approved: true });
    approvalManager.setHandler(mockHandler);

    const request: ApprovalRequest = {
      id: 'test-3',
      tool: 'cut_clip',
      description: 'Test cut',
      params: { clipId: '123', cutFrame: 100 },
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    const response = await approvalManager.requestApproval(request);
    expect(response.approved).toBe(true);
    expect(mockHandler).toHaveBeenCalledWith(request);
  });

  it('should cache approvals', async () => {
    const mockHandler = vi.fn().mockResolvedValue({ requestId: 'test-4', approved: true });
    approvalManager.setHandler(mockHandler);

    const request: ApprovalRequest = {
      id: 'test-4',
      tool: 'cut_clip',
      description: 'Test cut',
      params: { clipId: '123', cutFrame: 100 },
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    // First call
    await approvalManager.requestApproval(request);
    // Second call with same params
    await approvalManager.requestApproval(request);

    // Handler should only be called once
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it('should clear cache', async () => {
    const mockHandler = vi.fn().mockResolvedValue({ requestId: 'test-5', approved: true });
    approvalManager.setHandler(mockHandler);

    const request: ApprovalRequest = {
      id: 'test-5',
      tool: 'cut_clip',
      description: 'Test cut',
      params: { clipId: '123', cutFrame: 100 },
      riskLevel: 'medium',
      timestamp: Date.now(),
    };

    await approvalManager.requestApproval(request);
    approvalManager.clearCache();
    await approvalManager.requestApproval(request);

    expect(mockHandler).toHaveBeenCalledTimes(2);
  });
});

describe('withApproval', () => {
  beforeEach(() => {
    approvalManager.clearCache();
    approvalManager.setAutoApprove(true); // Auto-approve for tests
  });

  it('should execute function when approved', async () => {
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'result' }]
    });

    const result = await withApproval('cut_clip', 'Test cut', { clipId: '123' }, execute);

    expect(execute).toHaveBeenCalled();
    expect(result.content[0].text).toBe('result');
  });

  it('should return error when not approved', async () => {
    approvalManager.setAutoApprove(false);
    approvalManager.setHandler(null);

    const execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'result' }]
    });

    const result = await withApproval('cut_clip', 'Test cut', { clipId: '123' }, execute);

    expect(execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('No approval handler configured');
  });

  it('should not require approval for safe tools', async () => {
    approvalManager.setAutoApprove(false);
    approvalManager.setHandler(null);

    const execute = vi.fn().mockResolvedValue({
      content: [{ type: 'text' as const, text: 'result' }]
    });

    const result = await withApproval('get_project_info', 'Get project', {}, execute);

    expect(execute).toHaveBeenCalled();
    expect(result.content[0].text).toBe('result');
  });

  it('should propagate errors from execute function', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('Execution failed'));

    const result = await withApproval('cut_clip', 'Test cut', { clipId: '123' }, execute);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Execution failed');
  });
});