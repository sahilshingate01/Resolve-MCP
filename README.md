# Resolve MCP

A production-ready Model Context Protocol (MCP) server that connects AI assistants like Claude to DaVinci Resolve Studio for professional video editing automation.

## Features

- **Project Inspection**: Get project info, timelines, tracks, clips, and media pool contents
- **Media Import**: Import media files into the media pool with folder organization
- **Timeline Editing**: Cut, trim, ripple delete, add markers, and Text+ titles
- **Clip Properties**: Adjust opacity, volume, transform, speed, and color grade
- **Timeline Management**: Duplicate timelines, export to EDL/FCPXML/OTIO
- **Visual Verification**: Render frames and take screenshots for AI visual verification
- **Safety First**: Approval system for destructive actions
- **Cross-Platform**: macOS, Windows, and Linux support
- **MCP Compatible**: Works with Claude Desktop and other MCP clients

## Installation

### Via npx (Recommended)

```bash
npx resolve-mcp
```

### Global Install

```bash
npm install -g resolve-mcp
resolve-mcp
```

### Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "resolve-mcp": {
      "command": "npx",
      "args": ["resolve-mcp"],
      "env": {}
    }
  }
}
```

## Requirements

- **Node.js** 20+
- **Python** 3.8+ (for the Resolve bridge)
- **DaVinci Resolve Studio** 18+ (Free version has limited scripting support)
- **DaVinci Resolve running** with a project open

## Usage

### Start the MCP Server

```bash
# Default (stdio transport for MCP clients)
npx resolve-mcp

# Test connection
npx resolve-mcp test

# System check
npx resolve-mcp doctor

# With auto-approve (testing only)
npx resolve-mcp serve --auto-approve
```

### Available Tools

Once connected to an MCP client (like Claude), you can use these tools:

#### Project & Timeline Inspection
- `get_project_info` - Get full project details
- `get_timeline_info` - Get specific timeline details
- `list_timelines` - List all timelines
- `get_media_pool` - Get media pool contents
- `search_media_pool` - Search for clips

#### Media Import
- `import_media` - Import media files

#### Editing Operations
- `cut_clip` - Cut a clip at a specific frame
- `trim_clip` - Trim clip start/end with optional ripple
- `ripple_delete` - Remove timeline section with ripple edit
- `add_marker` - Add markers to timeline
- `add_text_title` - Add Text+ titles
- `duplicate_timeline` - Duplicate a timeline
- `adjust_clip_properties` - Adjust clip properties

#### Export
- `export_timeline` - Export to EDL, FCPXML, or OTIO

#### Visual Verification
- `render_frame` - Render a single frame
- `take_screenshot` - Take timeline viewer screenshot
- `get_resolve_version` - Get Resolve version info

## Example Workflows

### Basic Editing with Claude

```
User: "Open my project and show me the timeline structure"
Claude: [Calls get_project_info, lists timelines and tracks]

User: "Cut the clip at 00:01:30 and add a marker called 'Scene Change'"
Claude: [Calls cut_clip and add_marker with approval]

User: "Export the timeline as FCPXML for Final Cut Pro"
Claude: [Calls export_timeline with format: fcpXML]
```

### Visual Verification

```
User: "Show me frame 1500 of the timeline to verify the cut"
Claude: [Calls render_frame, returns image for visual verification]

User: "Take a screenshot at 00:02:15:10"
Claude: [Calls take_screenshot with timecode]
```

## Safety & Approval System

All destructive operations require explicit approval:

- **High Risk**: Ripple delete, trim with ripple, color grade changes
- **Medium Risk**: Cut, trim, markers, titles, duplicate, property adjustments, export, import
- **Low Risk**: Read-only operations (project info, timeline info, media pool)

The approval system integrates with MCP clients to prompt users before executing risky operations.

## Architecture

```
┌─────────────────┐     MCP Protocol      ┌──────────────────┐
│  AI Assistant   │ ◄────────────────────► │  Resolve MCP     │
│  (Claude, etc.) │   stdio/JSON-RPC       │  Server (Node.js)│
└─────────────────┘                        └────────┬─────────┘
                                                     │
                                              spawn/stdin
                                                     ▼
                                        ┌──────────────────────┐
                                        │  Python Bridge       │
                                        │  (resolve_bridge.py) │
                                        └──────────┬───────────┘
                                                   │
                                          Resolve Scripting API
                                                   ▼
                                        ┌──────────────────────┐
                                        │  DaVinci Resolve     │
                                        │  Studio              │
                                        └──────────────────────┘
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode with hot reload
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## Project Structure

```
resolve-mcp/
├── src/
│   ├── index.ts              # Main exports
│   ├── cli.ts                # CLI entry point
│   ├── types/index.ts        # TypeScript types
│   ├── server/mcp-server.ts  # MCP server implementation
│   ├── bridge/bridge-client.ts # Python bridge client
│   └── utils/approval.ts     # Approval system
├── bridge/
│   └── resolve_bridge.py     # Python Resolve bridge
├── tests/                    # Test files
├── dist/                     # Compiled output
├── package.json
├── tsconfig.json
└── README.md
```

## DaVinci Resolve Scripting Setup

### macOS
The scripting module is installed with Resolve at:
```
/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules
```

### Windows
```
C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\Modules
```

### Linux
```
/opt/resolve/Developer/Scripting/Modules
```

Ensure the `DaVinciResolveScript.py` module is in your Python path, or the bridge will auto-detect it.

## Troubleshooting

### "Could not connect to DaVinci Resolve"
- Ensure DaVinci Resolve is running
- Ensure a project is open
- Check that the scripting module is accessible

### "DaVinci Resolve scripting module not found"
- Verify Resolve Studio is installed (Free version has limited API)
- Check the platform-specific paths above
- Try running `python3 -c "import DaVinciResolveScript"`

### Permission denied on bridge script
```bash
chmod +x bridge/resolve_bridge.py
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## Support

- Issues: GitHub Issues
- Documentation: This README
- MCP Spec: https://modelcontextprotocol.io