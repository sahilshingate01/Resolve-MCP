/**
 * Approval system for destructive actions
 * Requires explicit user confirmation before executing risky operations
 */

import type { ApprovalRequest, ApprovalResponse } from "../types/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalResponse>;

const DANGEROUS_TOOLS = new Set([
  "cut_clip",
  "trim_clip",
  "ripple_delete",
  "add_marker",
  "add_text_title",
  "duplicate_timeline",
  "adjust_clip_properties",
  "export_timeline",
  "import_media",
]);

const HIGH_RISK_TOOLS = new Set([
  "ripple_delete",
  "trim_clip", // with ripple
  "adjust_clip_properties", // color grade changes
]);

export class ApprovalManager {
  private handler: ApprovalHandler | null = null;
  private autoApprove = false;
  private approvedCache = new Map<string, boolean>();

  setHandler(handler: ApprovalHandler): void {
    this.handler = handler;
  }

  setAutoApprove(enabled: boolean): void {
    this.autoApprove = enabled;
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    // Check cache
    const cacheKey = this.getCacheKey(request);
    if (this.approvedCache.has(cacheKey)) {
      return {
        requestId: request.id,
        approved: this.approvedCache.get(cacheKey)!,
      };
    }

    // Auto-approve if enabled (for testing)
    if (this.autoApprove) {
      return { requestId: request.id, approved: true };
    }

    // Use custom handler if provided
    if (this.handler) {
      const response = await this.handler(request);
      if (response.approved) {
        this.approvedCache.set(cacheKey, true);
      }
      return response;
    }

    // Default: deny for safety
    return {
      requestId: request.id,
      approved: false,
      reason: "No approval handler configured",
    };
  }

  private getCacheKey(request: ApprovalRequest): string {
    return `${request.tool}:${JSON.stringify(request.params)}`;
  }

  clearCache(): void {
    this.approvedCache.clear();
  }

  isDangerousTool(tool: string): boolean {
    return DANGEROUS_TOOLS.has(tool);
  }

  isHighRiskTool(tool: string): boolean {
    return HIGH_RISK_TOOLS.has(tool);
  }

  getRiskLevel(tool: string): "low" | "medium" | "high" {
    if (HIGH_RISK_TOOLS.has(tool)) return "high";
    if (DANGEROUS_TOOLS.has(tool)) return "medium";
    return "low";
  }
}

export const approvalManager = new ApprovalManager();

// Default CLI approval handler
export async function cliApprovalHandler(
  request: ApprovalRequest,
): Promise<ApprovalResponse> {
  const riskIndicator =
    request.riskLevel === "high"
      ? "🔴 HIGH RISK"
      : request.riskLevel === "medium"
        ? "🟡 MEDIUM RISK"
        : "🟢 LOW RISK";

  console.error(`\n${riskIndicator} - Approval Required`);
  console.error(`Tool: ${request.tool}`);
  console.error(`Description: ${request.description}`);
  console.error(`Parameters: ${JSON.stringify(request.params, null, 2)}`);
  console.error(`\nApprove this action? (y/N): `);

  // In a real MCP server, this would be handled via the client
  // For now, we'll simulate with a simple approach
  // The actual approval would come from the MCP client

  return {
    requestId: request.id,
    approved: false,
    reason: "MCP client must handle approval",
  };
}

// Create approval request helper
export function createApprovalRequest(
  tool: string,
  description: string,
  params: Record<string, unknown>,
): ApprovalRequest {
  return {
    id: crypto.randomUUID(),
    tool,
    description,
    params,
    riskLevel: approvalManager.getRiskLevel(tool),
    timestamp: Date.now(),
  };
}

// Wrapper to add approval to tool execution
export async function withApproval(
  tool: string,
  description: string,
  params: Record<string, unknown>,
  execute: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  // Check if approval needed
  if (!approvalManager.isDangerousTool(tool)) {
    try {
      return await execute();
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }

  const request = createApprovalRequest(tool, description, params);
  const response = await approvalManager.requestApproval(request);

  if (!response.approved) {
    return {
      content: [
        {
          type: "text" as const,
          text: response.reason || "Action not approved by user",
        },
      ],
      isError: true,
    };
  }

  try {
    return await execute();
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    };
  }
}
