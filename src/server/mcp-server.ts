/**
 * MCP Server for Resolve MCP
 * Implements the Model Context Protocol server with all Resolve tools
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
  ImageContent,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { bridgeClient } from '../bridge/bridge-client.js';
import { approvalManager, withApproval, createApprovalRequest } from '../utils/approval.js';
import {
  ProjectInfo,
  TimelineInfo,
  ClipInfo,
  MediaPoolInfo,
  Timecode,
  ToolResult,
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
} from '../types/index.js';

// Tool schemas using Zod for validation
const TimecodeSchema = z.object({
  hours: z.number().int().min(0).max(23),
  minutes: z.number().int().min(0).max(59),
  seconds: z.number().int().min(0).max(59),
  frames: z.number().int().min(0).max(99),
  frameRate: z.number().int().positive(),
  dropFrame: z.boolean(),
});

const ImportMediaSchema = z.object({
  filePaths: z.array(z.string()).min(1),
  targetFolder: z.string().optional(),
  copyToProject: z.boolean().optional(),
});

const CutClipSchema = z.object({
  clipId: z.string(),
  cutFrame: z.number().int().min(0),
});

const TrimClipSchema = z.object({
  clipId: z.string(),
  newStartFrame: z.number().int().min(0).optional(),
  newEndFrame: z.number().int().min(0).optional(),
  ripple: z.boolean().optional(),
});

const RippleDeleteSchema = z.object({
  timelineId: z.string(),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0),
  tracks: z.array(z.number().int().positive()).optional(),
});

const AddMarkerSchema = z.object({
  timelineId: z.string(),
  frame: z.number().int().min(0),
  name: z.string().min(1),
  note: z.string().optional(),
  color: z.string().optional(),
  duration: z.number().int().positive().optional(),
});

const AddTextTitleSchema = z.object({
  timelineId: z.string(),
  trackIndex: z.number().int().positive(),
  startFrame: z.number().int().min(0),
  duration: z.number().int().positive(),
  text: z.string().min(1),
  fontSize: z.number().int().positive().optional(),
  fontFamily: z.string().optional(),
  color: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  alignment: z.enum(['left', 'center', 'right']).optional(),
});

const DuplicateTimelineSchema = z.object({
  timelineId: z.string(),
  newName: z.string().min(1),
});

const AdjustClipPropertiesSchema = z.object({
  clipId: z.string(),
  properties: z.object({
    opacity: z.number().min(0).max(1).optional(),
    volume: z.number().min(0).max(10).optional(),
    pan: z.number().min(-1).max(1).optional(),
    pitch: z.number().min(-12).max(12).optional(),
    speed: z.number().positive().optional(),
    reverse: z.boolean().optional(),
    transform: z.object({
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      rotation: z.number().optional(),
      scale: z.object({ x: z.number(), y: z.number() }).optional(),
      anchor: z.object({ x: z.number(), y: z.number() }).optional(),
    }).optional(),
  }),
});

const ExportTimelineSchema = z.object({
  timelineId: z.string(),
  format: z.enum(['edl', 'fcpXML', 'otio']),
  outputPath: z.string().min(1),
  includeMarkers: z.boolean().optional(),
  includeTransitions: z.boolean().optional(),
});

const RenderFrameSchema = z.object({
  timelineId: z.string(),
  frameNumber: z.number().int().min(0),
  format: z.enum(['png', 'jpg', 'exr']).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  includeGuides: z.boolean().optional(),
});

const ScreenshotSchema = z.object({
  timelineId: z.string(),
  timecode: TimecodeSchema,
  format: z.enum(['png', 'jpg']).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

// Define all tools
const TOOLS: Tool[] = [
  // Project & Timeline Inspection
  {
    name: 'get_project_info',
    description: 'Get information about the currently open DaVinci Resolve project including timelines, tracks, and media pool',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_timeline_info',
    description: 'Get detailed information about a specific timeline',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string', description: 'Unique ID of the timeline' },
      },
      required: ['timelineId'],
    },
  },
  {
    name: 'list_timelines',
    description: 'List all timelines in the current project',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_media_pool',
    description: 'Get the media pool contents including folders and clips',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_media_pool',
    description: 'Search for clips in the media pool by name or metadata',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        folderId: { type: 'string', description: 'Optional folder to search within' },
      },
      required: ['query'],
    },
  },

  // Media Import
  {
    name: 'import_media',
    description: 'Import media files into the DaVinci Resolve media pool',
    inputSchema: {
      type: 'object',
      properties: {
        filePaths: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Paths to media files to import' },
        targetFolder: { type: 'string', description: 'Optional target folder name in media pool' },
        copyToProject: { type: 'boolean', description: 'Whether to copy files to project directory' },
      },
      required: ['filePaths'],
    },
  },

  // Editing Operations
  {
    name: 'cut_clip',
    description: 'Cut a clip at a specific frame, splitting it into two clips',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Unique ID of the clip to cut' },
        cutFrame: { type: 'number', description: 'Frame number to cut at (relative to timeline)' },
      },
      required: ['clipId', 'cutFrame'],
    },
  },
  {
    name: 'trim_clip',
    description: 'Trim the start or end of a clip, optionally with ripple edit',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Unique ID of the clip to trim' },
        newStartFrame: { type: 'number', description: 'New start frame (optional)' },
        newEndFrame: { type: 'number', description: 'New end frame (optional)' },
        ripple: { type: 'boolean', description: 'Whether to ripple edit (close gaps)' },
      },
      required: ['clipId'],
    },
  },
  {
    name: 'ripple_delete',
    description: 'Remove a section from the timeline with ripple edit (closing the gap)',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string', description: 'Unique ID of the timeline' },
        startFrame: { type: 'number', description: 'Start frame of range to delete' },
        endFrame: { type: 'number', description: 'End frame of range to delete' },
        tracks: { type: 'array', items: { type: 'number' }, description: 'Optional specific track indices to affect' },
      },
      required: ['timelineId', 'startFrame', 'endFrame'],
    },
  },
  {
    name: 'add_marker',
    description: 'Add a marker to the timeline at a specific frame',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string', description: 'Unique ID of the timeline' },
        frame: { type: 'number', description: 'Frame number to place marker' },
        name: { type: 'string', description: 'Marker name' },
        note: { type: 'string', description: 'Optional marker note' },
        color: { type: 'string', description: 'Marker color (Blue, Green, Red, etc.)' },
        duration: { type: 'number', description: 'Marker duration in frames' },
      },
      required: ['timelineId', 'frame', 'name'],
    },
  },
  {
    name: 'add_text_title',
    description: 'Add a Text+ title to the timeline',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string', description: 'Unique ID of the timeline' },
        trackIndex: { type: 'number', description: 'Video track index to add title to' },
        startFrame: { type: 'number', description: 'Start frame for the title' },
        duration: { type: 'number', description: 'Duration in frames' },
        text: { type: 'string', description: 'Title text content' },
        fontSize: { type: 'number', description: 'Font size in points' },
        fontFamily: { type: 'string', description: 'Font family name' },
        color: { type: 'string', description: 'Text color in hex (e.g., FFFFFF)' },
        position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: 'Position offset' },
        alignment: { type: 'string', enum: ['left', 'center', 'right'], description: 'Text alignment' },
      },
      required: ['timelineId', 'trackIndex', 'startFrame', 'duration', 'text'],
    },
  },
  {
    name: 'duplicate_timeline',
    description: 'Create a duplicate of an existing timeline with a new name',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string', description: 'Unique ID of the timeline to duplicate' },
        newName: { type: 'string', description: 'Name for the new timeline' },
      },
      required: ['timelineId', 'newName'],
    },
  },
  {
    name: 'adjust_clip_properties',
    description: 'Adjust clip properties like opacity, volume, transform, speed, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        clipId: { type: 'string', description: 'Unique ID of the clip' },
        properties: {
          type: 'object',
          properties: {
            opacity: { type: 'number', minimum: 0, maximum: 1 },
            volume: { type: 'number', minimum: 0, maximum: 10 },
            pan: { type: 'number', minimum: -1, maximum: 1 },
            pitch: { type: 'number', minimum: -12, maximum: 12 },
            speed: { type: 'number', minimum: 0.01 },
            reverse: { type: 'boolean' },
            transform: {
              type: 'object',
              properties: {
                position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
                rotation: { type: 'number' },
                scale: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
                anchor: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
              },
            },
          },
        },
      },
      required: ['clipId', 'properties'],
    },
  },

  // Export
  {
    name: 'export_timeline',
    description: 'Export timeline to EDL, FCPXML, or OTIO format',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string', description: 'Unique ID of the timeline to export' },
        format: { type: 'string', enum: ['edl', 'fcpXML', 'otio'], description: 'Export format' },
        outputPath: { type: 'string', description: 'Output file path' },
        includeMarkers: { type: 'boolean', description: 'Include markers in export' },
        includeTransitions: { type: 'boolean', description: 'Include transitions in export' },
      },
      required: ['timelineId', 'format', 'outputPath'],
    },
  },

  // Frame Rendering & Screenshot
  {
    name: 'render_frame',
    description: 'Render a single frame from the timeline to an image file',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string', description: 'Unique ID of the timeline' },
        frameNumber: { type: 'number', description: 'Frame number to render' },
        format: { type: 'string', enum: ['png', 'jpg', 'exr'], description: 'Output image format' },
        width: { type: 'number', description: 'Output width in pixels' },
        height: { type: 'number', description: 'Output height in pixels' },
        includeGuides: { type: 'boolean', description: 'Include safe area guides' },
      },
      required: ['timelineId', 'frameNumber'],
    },
  },
  {
    name: 'take_screenshot',
    description: 'Take a screenshot of the timeline viewer at a specific timecode',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string', description: 'Unique ID of the timeline' },
        timecode: {
          type: 'object',
          properties: {
            hours: { type: 'number' },
            minutes: { type: 'number' },
            seconds: { type: 'number' },
            frames: { type: 'number' },
            frameRate: { type: 'number' },
            dropFrame: { type: 'boolean' },
          },
          required: ['hours', 'minutes', 'seconds', 'frames', 'frameRate', 'dropFrame'],
        },
        format: { type: 'string', enum: ['png', 'jpg'], description: 'Output image format' },
        width: { type: 'number', description: 'Output width in pixels' },
        height: { type: 'number', description: 'Output height in pixels' },
      },
      required: ['timelineId', 'timecode'],
    },
  },
  {
    name: 'get_resolve_version',
    description: 'Get the connected DaVinci Resolve version information',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export class ResolveMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'resolve-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: TOOLS };
    });

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        return await this.handleToolCall(name, args);
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleToolCall(name: string, args: unknown): Promise<CallToolResult> {
    // Project & Timeline Inspection
    if (name === 'get_project_info') {
      return this.handleGetProjectInfo();
    }
    if (name === 'get_timeline_info') {
      return this.handleGetTimelineInfo(args);
    }
    if (name === 'list_timelines') {
      return this.handleListTimelines();
    }
    if (name === 'get_media_pool') {
      return this.handleGetMediaPool();
    }
    if (name === 'search_media_pool') {
      return this.handleSearchMediaPool(args);
    }

    // Media Import
    if (name === 'import_media') {
      return this.handleImportMedia(args);
    }

    // Editing Operations
    if (name === 'cut_clip') {
      return this.handleCutClip(args);
    }
    if (name === 'trim_clip') {
      return this.handleTrimClip(args);
    }
    if (name === 'ripple_delete') {
      return this.handleRippleDelete(args);
    }
    if (name === 'add_marker') {
      return this.handleAddMarker(args);
    }
    if (name === 'add_text_title') {
      return this.handleAddTextTitle(args);
    }
    if (name === 'duplicate_timeline') {
      return this.handleDuplicateTimeline(args);
    }
    if (name === 'adjust_clip_properties') {
      return this.handleAdjustClipProperties(args);
    }

    // Export
    if (name === 'export_timeline') {
      return this.handleExportTimeline(args);
    }

    // Frame Rendering & Screenshot
    if (name === 'render_frame') {
      return this.handleRenderFrame(args);
    }
    if (name === 'take_screenshot') {
      return this.handleTakeScreenshot(args);
    }
    if (name === 'get_resolve_version') {
      return this.handleGetResolveVersion();
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  // === Handler Methods ===

  private async handleGetProjectInfo() {
    const result = await bridgeClient.getProject();

    if (!result.success) {
      throw new Error(result.error);
    }

    const project = result.data as ProjectInfo;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(project, null, 2),
        },
      ],
    };
  }

  private async handleGetTimelineInfo(args: unknown) {
    const { timelineId } = z.object({ timelineId: z.string() }).parse(args);

    const projectResult = await bridgeClient.getProject();
    if (!projectResult.success) {
      throw new Error(projectResult.error);
    }

    const project = projectResult.data as ProjectInfo;
    const timeline = project.timelines.find(t => t.id === timelineId);

    if (!timeline) {
      throw new Error(`Timeline not found: ${timelineId}`);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(timeline, null, 2),
        },
      ],
    };
  }

  private async handleListTimelines() {
    const result = await bridgeClient.getProject();

    if (!result.success) {
      throw new Error(result.error);
    }

    const project = result.data as ProjectInfo;
    const timelines = project.timelines.map(t => ({
      id: t.id,
      name: t.name,
      frameRate: t.frameRate,
      duration: t.duration,
      trackCount: t.tracks.length,
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(timelines, null, 2),
        },
      ],
    };
  }

  private async handleGetMediaPool() {
    const result = await bridgeClient.getProject();

    if (!result.success) {
      throw new Error(result.error);
    }

    const project = result.data as ProjectInfo;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(project.mediaPool, null, 2),
        },
      ],
    };
  }

  private async handleSearchMediaPool(args: unknown) {
    const { query, folderId } = z.object({ query: z.string(), folderId: z.string().optional() }).parse(args);

    const result = await bridgeClient.getProject();
    if (!result.success) {
      throw new Error(result.error);
    }

    const project = result.data as ProjectInfo;
    const allClips = this.getAllClips(project.mediaPool.rootFolder);
    const matches = allClips.filter(clip =>
      clip.name.toLowerCase().includes(query.toLowerCase()) ||
      JSON.stringify(clip.metadata).toLowerCase().includes(query.toLowerCase())
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(matches, null, 2),
        },
      ],
    };
  }

  private getAllClips(folder: MediaPoolInfo['rootFolder']): MediaPoolInfo['clips'] {
    let clips = [...folder.clips];
    for (const subFolder of folder.subFolders) {
      clips = clips.concat(this.getAllClips(subFolder));
    }
    return clips;
  }

  private async handleImportMedia(args: unknown) {
    const options = ImportMediaSchema.parse(args);

    return withApproval(
      'import_media',
      `Import ${options.filePaths.length} media file(s) into the media pool`,
      options,
      async () => {
        const result = await bridgeClient.importMedia(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Successfully imported ${result.data.imported.length} media file(s)`,
            },
          ],
        };
      }
    );
  }

  private async handleCutClip(args: unknown) {
    const options = CutClipSchema.parse(args);

    return withApproval(
      'cut_clip',
      `Cut clip ${options.clipId} at frame ${options.cutFrame}`,
      options,
      async () => {
        const result = await bridgeClient.cutClip(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: result.data.message,
            },
          ],
        };
      }
    );
  }

  private async handleTrimClip(args: unknown) {
    const options = TrimClipSchema.parse(args);

    const description = `Trim clip ${options.clipId}${options.newStartFrame !== undefined ? ` start to ${options.newStartFrame}` : ''}${options.newEndFrame !== undefined ? ` end to ${options.newEndFrame}` : ''}${options.ripple ? ' with ripple' : ''}`;

    return withApproval(
      'trim_clip',
      description,
      options,
      async () => {
        const result = await bridgeClient.trimClip(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: result.data.message,
            },
          ],
        };
      }
    );
  }

  private async handleRippleDelete(args: unknown) {
    const options = RippleDeleteSchema.parse(args);

    return withApproval(
      'ripple_delete',
      `Ripple delete frames ${options.startFrame}-${options.endFrame} from timeline ${options.timelineId}${options.tracks ? ` on tracks ${options.tracks.join(', ')}` : ''}`,
      options,
      async () => {
        const result = await bridgeClient.rippleDelete(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `${result.data.message} (deleted ${result.data.deleted.length} clips)`,
            },
          ],
        };
      }
    );
  }

  private async handleAddMarker(args: unknown) {
    const options = AddMarkerSchema.parse(args);

    return withApproval(
      'add_marker',
      `Add marker "${options.name}" at frame ${options.frame} on timeline ${options.timelineId}`,
      options,
      async () => {
        const result = await bridgeClient.addMarker(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: result.data.message,
            },
          ],
        };
      }
    );
  }

  private async handleAddTextTitle(args: unknown) {
    const options = AddTextTitleSchema.parse(args);

    return withApproval(
      'add_text_title',
      `Add Text+ title "${options.text}" on track ${options.trackIndex} at frame ${options.startFrame} for ${options.duration} frames`,
      options,
      async () => {
        const result = await bridgeClient.addTextTitle(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: result.data.message,
            },
          ],
        };
      }
    );
  }

  private async handleDuplicateTimeline(args: unknown) {
    const options = DuplicateTimelineSchema.parse(args);

    return withApproval(
      'duplicate_timeline',
      `Duplicate timeline ${options.timelineId} as "${options.newName}"`,
      options,
      async () => {
        const result = await bridgeClient.duplicateTimeline(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: result.data.message,
            },
          ],
        };
      }
    );
  }

  private async handleAdjustClipProperties(args: unknown) {
    const options = AdjustClipPropertiesSchema.parse(args);

    return withApproval(
      'adjust_clip_properties',
      `Adjust properties of clip ${options.clipId}: ${JSON.stringify(options.properties)}`,
      options,
      async () => {
        const result = await bridgeClient.adjustClipProperties(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: result.data.message,
            },
          ],
        };
      }
    );
  }

  private async handleExportTimeline(args: unknown) {
    const options = ExportTimelineSchema.parse(args);

    return withApproval(
      'export_timeline',
      `Export timeline ${options.timelineId} to ${options.format.toUpperCase()} at ${options.outputPath}`,
      options,
      async () => {
        const result = await bridgeClient.exportTimeline(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: result.data.message,
            },
          ],
        };
      }
    );
  }

  private async handleRenderFrame(args: unknown) {
    const options = RenderFrameSchema.parse(args);

    return withApproval(
      'render_frame',
      `Render frame ${options.frameNumber} from timeline ${options.timelineId}`,
      options,
      async () => {
        const result = await bridgeClient.renderFrame(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: result.data.message,
            },
          ],
        };
      }
    );
  }

  private async handleTakeScreenshot(args: unknown) {
    const options = ScreenshotSchema.parse(args);

    return withApproval(
      'take_screenshot',
      `Take screenshot of timeline ${options.timelineId} at ${options.timecode.hours}:${options.timecode.minutes}:${options.timecode.seconds}:${options.timecode.frames}`,
      options,
      async () => {
        const result = await bridgeClient.takeScreenshot(options);

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: result.data.message,
            },
          ],
        };
      }
    );
  }

  private async handleGetResolveVersion() {
    const result = await bridgeClient.getVersion();

    if (!result.success) {
      throw new Error(result.error);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result.data, null, 2),
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Resolve MCP Server running on stdio');
  }
}