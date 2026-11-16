/**
 * Bridge client to communicate with the Python/Lua Resolve bridge
 */

import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import type {
  BridgeRequest,
  BridgeResponse,
  ProjectInfo,
  MediaPoolInfo,
  ImportMediaOptions,
  CutClipOptions,
  TrimClipOptions,
  RippleDeleteOptions,
  AddMarkerOptions,
  AddTextTitleOptions,
  DuplicateTimelineOptions,
  AdjustClipPropertiesOptions,
  ExportOptions,
  FrameRenderOptions,
  ScreenshotOptions,
  ResolveVersion,
  ToolResult,
} from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class BridgeClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private bridgePath: string;
  private connected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    // Path to the Python bridge script
    this.bridgePath = path.join(
      __dirname,
      "..",
      "..",
      "bridge",
      "resolve_bridge.py",
    );
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = new Promise((resolve, reject) => {
      this.startBridgeProcess()
        .then(() => {
          this.connected = true;
          resolve();
        })
        .catch(reject);
    });

    return this.connectionPromise;
  }

  private startBridgeProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonCmd = process.platform === "win32" ? "python" : "python3";

      this.process = spawn(pythonCmd, [this.bridgePath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      let connectionResult: { success?: boolean; error?: string } | null = null;

      this.process.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line) as {
              type?: string;
              result?: { success?: boolean; error?: string };
              id?: number;
              error?: { message: string };
            };
            if (message.type === "connect") {
              connectionResult = message.result ?? null;
              if (connectionResult?.success) {
                resolve();
              } else {
                reject(
                  new Error(
                    connectionResult?.error || "Failed to connect to Resolve",
                  ),
                );
              }
            } else if (message.id !== undefined) {
              this.handleResponse(message as BridgeResponse);
            }
          } catch {
            console.error("Failed to parse bridge output:", line);
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        console.error("Bridge stderr:", data.toString());
      });

      this.process.on("error", (err) => {
        reject(new Error(`Failed to start bridge process: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        this.connected = false;
        this.process = null;
        if (code !== 0 && !connectionResult?.success) {
          reject(new Error(`Bridge process exited with code ${code}`));
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!connectionResult) {
          reject(new Error("Bridge connection timeout"));
        }
      }, 10000);
    });
  }

  private handleResponse(response: BridgeResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      this.pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private async sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    await this.connect();

    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error("Bridge process not running"));
        return;
      }

      const id = ++this.requestId;
      const request: BridgeRequest = { id, method, params };

      this.pendingRequests.set(id, { resolve, reject });

      this.process.stdin.write(JSON.stringify(request) + "\n");

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  // === Project & Timeline Inspection ===

  async getProject(): Promise<ToolResult<ProjectInfo>> {
    try {
      const result = await this.sendRequest("get_project", {});
      return result as ToolResult<ProjectInfo>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  async getVersion(): Promise<ToolResult<ResolveVersion>> {
    try {
      const result = await this.sendRequest("get_version", {});
      return result as ToolResult<ResolveVersion>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  // === Media Import ===

  async importMedia(
    options: ImportMediaOptions,
  ): Promise<ToolResult<{ imported: MediaPoolInfo["clips"] }>> {
    try {
      const result = await this.sendRequest("import_media", {
        filePaths: options.filePaths,
        targetFolder: options.targetFolder,
      });
      return result as ToolResult<{ imported: MediaPoolInfo["clips"] }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  // === Editing Operations ===

  async cutClip(
    options: CutClipOptions,
  ): Promise<ToolResult<{ message: string }>> {
    try {
      const result = await this.sendRequest("cut_clip", {
        clipId: options.clipId,
        cutFrame: options.cutFrame,
      });
      return result as ToolResult<{ message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  async trimClip(
    options: TrimClipOptions,
  ): Promise<ToolResult<{ message: string }>> {
    try {
      const result = await this.sendRequest("trim_clip", {
        clipId: options.clipId,
        newStartFrame: options.newStartFrame,
        newEndFrame: options.newEndFrame,
        ripple: options.ripple,
      });
      return result as ToolResult<{ message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  async rippleDelete(
    options: RippleDeleteOptions,
  ): Promise<ToolResult<{ deleted: string[]; message: string }>> {
    try {
      const result = await this.sendRequest("ripple_delete", {
        timelineId: options.timelineId,
        startFrame: options.startFrame,
        endFrame: options.endFrame,
        tracks: options.tracks,
      });
      return result as ToolResult<{ deleted: string[]; message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  async addMarker(
    options: AddMarkerOptions,
  ): Promise<ToolResult<{ markerId: string; message: string }>> {
    try {
      const result = await this.sendRequest("add_marker", {
        timelineId: options.timelineId,
        frame: options.frame,
        name: options.name,
        note: options.note,
        color: options.color,
        duration: options.duration,
      });
      return result as ToolResult<{ markerId: string; message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  async addTextTitle(
    options: AddTextTitleOptions,
  ): Promise<ToolResult<{ clipId: string; message: string }>> {
    try {
      const result = await this.sendRequest("add_text_title", {
        timelineId: options.timelineId,
        trackIndex: options.trackIndex,
        startFrame: options.startFrame,
        duration: options.duration,
        text: options.text,
        fontSize: options.fontSize,
        fontFamily: options.fontFamily,
        color: options.color,
        position: options.position,
        alignment: options.alignment,
      });
      return result as ToolResult<{ clipId: string; message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  async duplicateTimeline(
    options: DuplicateTimelineOptions,
  ): Promise<ToolResult<{ timelineId: string; message: string }>> {
    try {
      const result = await this.sendRequest("duplicate_timeline", {
        timelineId: options.timelineId,
        newName: options.newName,
      });
      return result as ToolResult<{ timelineId: string; message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  async adjustClipProperties(
    options: AdjustClipPropertiesOptions,
  ): Promise<ToolResult<{ message: string }>> {
    try {
      const result = await this.sendRequest("adjust_clip_properties", {
        clipId: options.clipId,
        properties: options.properties,
      });
      return result as ToolResult<{ message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  // === Export ===

  async exportTimeline(
    options: ExportOptions,
  ): Promise<ToolResult<{ outputPath: string; message: string }>> {
    try {
      const result = await this.sendRequest("export_timeline", {
        timelineId: options.timelineId,
        format: options.format,
        outputPath: options.outputPath,
        includeMarkers: options.includeMarkers,
        includeTransitions: options.includeTransitions,
      });
      return result as ToolResult<{ outputPath: string; message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  // === Frame Rendering & Screenshot ===

  async renderFrame(
    options: FrameRenderOptions,
  ): Promise<ToolResult<{ message: string }>> {
    try {
      const result = await this.sendRequest("render_frame", {
        timelineId: options.timelineId,
        frameNumber: options.frameNumber,
        format: options.format,
        width: options.width,
        height: options.height,
      });
      return result as ToolResult<{ message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  async takeScreenshot(
    options: ScreenshotOptions,
  ): Promise<ToolResult<{ message: string }>> {
    try {
      const result = await this.sendRequest("take_screenshot", {
        timelineId: options.timelineId,
        timecode: options.timecode,
        format: options.format,
        width: options.width,
        height: options.height,
      });
      return result as ToolResult<{ message: string }>;
    } catch (error) {
      return { success: false, error: String(error), code: "BRIDGE_ERROR" };
    }
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.connected = false;
    }
  }
}

// Singleton instance
export const bridgeClient = new BridgeClient();
