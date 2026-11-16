/**
 * Core type definitions for Resolve MCP
 */

export interface ProjectInfo {
  name: string;
  path: string;
  frameRate: number;
  resolution: { width: number; height: number };
  timelines: TimelineInfo[];
  mediaPool: MediaPoolInfo;
}

export interface TimelineInfo {
  name: string;
  id: string;
  frameRate: number;
  duration: Timecode;
  tracks: TrackInfo[];
  startTimecode: Timecode;
}

export interface TrackInfo {
  index: number;
  type: "video" | "audio" | "subtitle";
  name: string;
  clips: ClipInfo[];
}

export interface ClipInfo {
  id: string;
  name: string;
  trackIndex: number;
  startFrame: number;
  endFrame: number;
  duration: number;
  mediaPoolItemId: string;
  mediaPoolItemName: string;
  filePath?: string;
  markers: MarkerInfo[];
  properties: ClipProperties;
}

export interface MarkerInfo {
  frame: number;
  name: string;
  note: string;
  color: string;
  duration: number;
}

export interface ClipProperties {
  opacity?: number;
  volume?: number;
  pan?: number;
  pitch?: number;
  speed?: number;
  reverse?: boolean;
  transform?: Partial<Transform>;
  colorGrade?: ColorGrade;
}

export interface Transform {
  position: { x: number; y: number };
  rotation: number;
  scale: { x: number; y: number };
  anchor: { x: number; y: number };
}

export interface ColorGrade {
  lift: { r: number; g: number; b: number };
  gamma: { r: number; g: number; b: number };
  gain: { r: number; g: number; b: number };
  offset: { r: number; g: number; b: number };
  contrast: number;
  saturation: number;
}

export interface MediaPoolInfo {
  rootFolder: FolderInfo;
  clips: MediaPoolItemInfo[];
  folders: FolderInfo[];
}

export interface FolderInfo {
  id: string;
  name: string;
  parentId?: string;
  clips: MediaPoolItemInfo[];
  subFolders: FolderInfo[];
}

export interface MediaPoolItemInfo {
  id: string;
  name: string;
  filePath: string;
  duration: number;
  frameRate: number;
  resolution: { width: number; height: number };
  metadata: Record<string, unknown>;
}

export interface Timecode {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  frameRate: number;
  dropFrame: boolean;
}

export interface FrameRenderOptions {
  timelineId: string;
  frameNumber: number;
  format?: "png" | "jpg" | "exr";
  width?: number;
  height?: number;
  includeGuides?: boolean;
}

export interface ScreenshotOptions {
  timelineId: string;
  timecode: Timecode;
  format?: "png" | "jpg";
  width?: number;
  height?: number;
}

export interface ExportOptions {
  timelineId: string;
  format: "edl" | "fcpXML" | "otio";
  outputPath: string;
  includeMarkers?: boolean;
  includeTransitions?: boolean;
}

export interface ImportMediaOptions {
  filePaths: string[];
  targetFolder?: string;
  copyToProject?: boolean;
}

export interface CutClipOptions {
  clipId: string;
  cutFrame: number;
}

export interface TrimClipOptions {
  clipId: string;
  newStartFrame?: number;
  newEndFrame?: number;
  ripple?: boolean;
}

export interface RippleDeleteOptions {
  timelineId: string;
  startFrame: number;
  endFrame: number;
  tracks?: number[];
}

export interface AddMarkerOptions {
  timelineId: string;
  frame: number;
  name: string;
  note?: string;
  color?: string;
  duration?: number;
}

export interface AddTextTitleOptions {
  timelineId: string;
  trackIndex: number;
  startFrame: number;
  duration: number;
  text: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  position?: { x: number; y: number };
  alignment?: "left" | "center" | "right";
}

export interface DuplicateTimelineOptions {
  timelineId: string;
  newName: string;
}

export interface AdjustClipPropertiesOptions {
  clipId: string;
  properties: Partial<ClipProperties>;
}

export type ToolResult<T = unknown> =
  { success: true; data: T } | { success: false; error: string; code: string };

export interface ApprovalRequest {
  id: string;
  tool: string;
  description: string;
  params: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  timestamp: number;
}

export interface ApprovalResponse {
  requestId: string;
  approved: boolean;
  reason?: string;
}

export interface BridgeRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export interface BridgeResponse {
  id: number;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface ResolveVersion {
  version: string;
  build: string;
  platform: "mac" | "windows" | "linux";
}
