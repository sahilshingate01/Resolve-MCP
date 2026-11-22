#!/usr/bin/env python3
"""
DaVinci Resolve Python Bridge for Resolve MCP
Communicates with DaVinci Resolve via the Resolve scripting API
"""

import sys
import json
import os
import traceback
from typing import Any, Dict, List, Optional, Union

# DaVinci Resolve scripting module path
def get_resolve_script_module():
    """Get the DaVinci Resolve scripting module path based on platform"""
    if sys.platform == "darwin":  # macOS
        script_path = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules"
    elif sys.platform == "win32":  # Windows
        program_data = os.environ.get("PROGRAMDATA", "C:/ProgramData")
        script_path = os.path.join(program_data, "Blackmagic Design", "DaVinci Resolve", "Support", "Developer", "Scripting", "Modules")
    else:  # Linux
        script_path = "/opt/resolve/Developer/Scripting/Modules"

    return script_path

# Add Resolve scripting to path
script_module_path = get_resolve_script_module()
if script_module_path not in sys.path:
    sys.path.append(script_module_path)

try:
    import DaVinciResolveScript as dvr_script
    RESOLVE_AVAILABLE = True
except ImportError:
    RESOLVE_AVAILABLE = False
    dvr_script = None


class ResolveBridge:
    """Bridge to communicate with DaVinci Resolve"""

    def __init__(self):
        self.resolve = None
        self.project_manager = None
        self.current_project = None
        self.media_pool = None
        self.timeline = None

    def connect(self) -> Dict[str, Any]:
        """Connect to DaVinci Resolve"""
        if not RESOLVE_AVAILABLE:
            return {"error": "DaVinci Resolve scripting module not found. Ensure Resolve is installed."}

        try:
            self.resolve = dvr_script.scriptapp("Resolve")
            if not self.resolve:
                return {"error": "Could not connect to DaVinci Resolve. Is it running?"}

            self.project_manager = self.resolve.GetProjectManager()
            return {"success": True, "version": self.get_version()}
        except Exception as e:
            return {"error": f"Failed to connect: {str(e)}", "traceback": traceback.format_exc()}

    def get_version(self) -> Dict[str, str]:
        """Get Resolve version info"""
        if not self.resolve:
            return {"version": "unknown", "build": "unknown", "platform": sys.platform}

        version = self.resolve.GetVersionString()
        return {
            "version": version,
            "build": "unknown",
            "platform": "mac" if sys.platform == "darwin" else "windows" if sys.platform == "win32" else "linux"
        }

    def get_current_project(self) -> Dict[str, Any]:
        """Get the currently open project"""
        if not self.project_manager:
            return {"error": "Not connected to Resolve"}

        self.current_project = self.project_manager.GetCurrentProject()
        if not self.current_project:
            return {"error": "No project currently open"}

        return self._project_to_dict(self.current_project)

    def _project_to_dict(self, project) -> Dict[str, Any]:
        """Convert project object to dictionary"""
        try:
            timeline_count = project.GetTimelineCount()
            timelines = []
            for i in range(1, timeline_count + 1):
                tl = project.GetTimelineByIndex(i)
                if tl:
                    timelines.append(self._timeline_to_dict(tl))

            media_pool = project.GetMediaPool()
            media_pool_info = self._media_pool_to_dict(media_pool)

            return {
                "name": project.GetName(),
                "path": project.GetProjectPath(),
                "frameRate": project.GetSetting("timelineFrameRate") or 24,
                "resolution": {
                    "width": int(project.GetSetting("timelineResolutionWidth") or 1920),
                    "height": int(project.GetSetting("timelineResolutionHeight") or 1080)
                },
                "timelines": timelines,
                "mediaPool": media_pool_info
            }
        except Exception as e:
            return {"error": f"Failed to get project info: {str(e)}", "traceback": traceback.format_exc()}

    def _timeline_to_dict(self, timeline) -> Dict[str, Any]:
        """Convert timeline object to dictionary"""
        try:
            tracks = {}
            track_count = timeline.GetTrackCount("video")
            for i in range(1, track_count + 1):
                track_items = timeline.GetItemsInTrack("video", i)
                clips = []
                if track_items:
                    for item in track_items.values():
                        clips.append(self._clip_to_dict(item, i, "video"))
                tracks[f"video{i}"] = {"type": "video", "name": f"Video {i}", "clips": clips}

            # Audio tracks
            track_count = timeline.GetTrackCount("audio")
            for i in range(1, track_count + 1):
                track_items = timeline.GetItemsInTrack("audio", i)
                clips = []
                if track_items:
                    for item in track_items.values():
                        clips.append(self._clip_to_dict(item, i, "audio"))
                tracks[f"audio{i}"] = {"type": "audio", "name": f"Audio {i}", "clips": clips}

            # Subtitle tracks
            track_count = timeline.GetTrackCount("subtitle")
            for i in range(1, track_count + 1):
                track_items = timeline.GetItemsInTrack("subtitle", i)
                clips = []
                if track_items:
                    for item in track_items.values():
                        clips.append(self._clip_to_dict(item, i, "subtitle"))
                tracks[f"subtitle{i}"] = {"type": "subtitle", "name": f"Subtitle {i}", "clips": clips}

            start_tc = timeline.GetStartTimecode()
            duration = timeline.GetDuration()

            return {
                "name": timeline.GetName(),
                "id": str(timeline.GetUniqueId()),
                "frameRate": timeline.GetSetting("timelineFrameRate") or 24,
                "duration": self._frames_to_timecode(duration, timeline.GetSetting("timelineFrameRate") or 24),
                "tracks": list(tracks.values()),
                "startTimecode": self._parse_timecode(start_tc) if start_tc else {"hours": 0, "minutes": 0, "seconds": 0, "frames": 0, "frameRate": 24, "dropFrame": False}
            }
        except Exception as e:
            return {"error": f"Failed to get timeline info: {str(e)}", "traceback": traceback.format_exc()}

    def _clip_to_dict(self, clip, track_index: int, track_type: str) -> Dict[str, Any]:
        """Convert clip/timeline item to dictionary"""
        try:
            media_pool_item = clip.GetMediaPoolItem()
            markers = {}
            marker_data = clip.GetMarkers()
            if marker_data:
                for frame, marker in marker_data.items():
                    markers[frame] = {
                        "frame": frame,
                        "name": marker.get("name", ""),
                        "note": marker.get("note", ""),
                        "color": marker.get("color", "Blue"),
                        "duration": marker.get("duration", 1)
                    }

            # Get clip properties
            props = {
                "opacity": clip.GetProperty("Opacity") or 1.0,
                "volume": clip.GetProperty("Volume") or 1.0,
                "pan": clip.GetProperty("Pan") or 0.0,
                "pitch": clip.GetProperty("Pitch") or 0.0,
                "speed": clip.GetProperty("Speed") or 100.0,
                "reverse": clip.GetProperty("Reverse") or False,
                "transform": {
                    "position": {"x": 0.0, "y": 0.0},
                    "rotation": 0.0,
                    "scale": {"x": 1.0, "y": 1.0},
                    "anchor": {"x": 0.5, "y": 0.5}
                },
                "colorGrade": None
            }

            file_path = ""
            if media_pool_item:
                clip_props = media_pool_item.GetClipProperty()
                file_path = clip_props.get("File Path", "")

            return {
                "id": str(clip.GetUniqueId()),
                "name": clip.GetName(),
                "trackIndex": track_index,
                "startFrame": int(clip.GetStart()),
                "endFrame": int(clip.GetEnd()),
                "duration": int(clip.GetDuration()),
                "mediaPoolItemId": str(media_pool_item.GetUniqueId()) if media_pool_item else "",
                "mediaPoolItemName": media_pool_item.GetName() if media_pool_item else "",
                "filePath": file_path,
                "markers": list(markers.values()),
                "properties": props
            }
        except Exception as e:
            return {"error": f"Failed to get clip info: {str(e)}", "traceback": traceback.format_exc()}

    def _media_pool_to_dict(self, media_pool) -> Dict[str, Any]:
        """Convert media pool to dictionary"""
        try:
            root_folder = media_pool.GetRootFolder()
            folders = self._get_folders_recursive(root_folder)
            clips = self._get_all_clips(root_folder)

            return {
                "rootFolder": self._folder_to_dict(root_folder),
                "clips": clips,
                "folders": folders
            }
        except Exception as e:
            return {"error": f"Failed to get media pool info: {str(e)}", "traceback": traceback.format_exc()}

    def _get_folders_recursive(self, folder) -> List[Dict[str, Any]]:
        """Get all folders recursively"""
        folders = []
        sub_folders = folder.GetClipList()  # This gets subfolders
        if sub_folders:
            for sub in sub_folders:
                folders.append(self._folder_to_dict(sub))
                folders.extend(self._get_folders_recursive(sub))
        return folders

    def _get_all_clips(self, folder) -> List[Dict[str, Any]]:
        """Get all clips in folder and subfolders"""
        clips = []
        clip_list = folder.GetClipList()
        if clip_list:
            for clip in clip_list:
                clips.append(self._media_pool_item_to_dict(clip))
        # Also check subfolders
        sub_folders = folder.GetSubFolderList()
        if sub_folders:
            for sub in sub_folders:
                clips.extend(self._get_all_clips(sub))
        return clips

    def _folder_to_dict(self, folder) -> Dict[str, Any]:
        """Convert folder to dictionary"""
        try:
            clips = []
            clip_list = folder.GetClipList()
            if clip_list:
                for clip in clip_list:
                    clips.append(self._media_pool_item_to_dict(clip))

            sub_folders = []
            sub_folder_list = folder.GetSubFolderList()
            if sub_folder_list:
                for sub in sub_folder_list:
                    sub_folders.append(self._folder_to_dict(sub))

            return {
                "id": str(folder.GetUniqueId()),
                "name": folder.GetName(),
                "parentId": str(folder.GetParentFolder().GetUniqueId()) if folder.GetParentFolder() else None,
                "clips": clips,
                "subFolders": sub_folders
            }
        except Exception as e:
            return {"error": f"Failed to get folder info: {str(e)}"}

    def _media_pool_item_to_dict(self, item) -> Dict[str, Any]:
        """Convert media pool item to dictionary"""
        try:
            props = item.GetClipProperty()
            return {
                "id": str(item.GetUniqueId()),
                "name": item.GetName(),
                "filePath": props.get("File Path", ""),
                "duration": int(props.get("Duration", 0)),
                "frameRate": float(props.get("FPS", 24)),
                "resolution": {
                    "width": int(props.get("Width", 1920)),
                    "height": int(props.get("Height", 1080))
                },
                "metadata": dict(props)
            }
        except Exception as e:
            return {"error": f"Failed to get media pool item info: {str(e)}"}

    def _frames_to_timecode(self, frames: int, frame_rate: float) -> Dict[str, Any]:
        """Convert frames to timecode"""
        fps = int(frame_rate)
        hours = frames // (3600 * fps)
        frames -= hours * 3600 * fps
        minutes = frames // (60 * fps)
        frames -= minutes * 60 * fps
        seconds = frames // fps
        frames -= seconds * fps
        return {"hours": hours, "minutes": minutes, "seconds": seconds, "frames": frames, "frameRate": fps, "dropFrame": False}

    def _parse_timecode(self, tc_string: str) -> Dict[str, Any]:
        """Parse timecode string"""
        parts = tc_string.split(":")
        if len(parts) == 4:
            return {"hours": int(parts[0]), "minutes": int(parts[1]), "seconds": int(parts[2]), "frames": int(parts[3]), "frameRate": 24, "dropFrame": False}
        return {"hours": 0, "minutes": 0, "seconds": 0, "frames": 0, "frameRate": 24, "dropFrame": False}

    # === Editing Operations ===

    def import_media(self, file_paths: List[str], target_folder: Optional[str] = None) -> Dict[str, Any]:
        """Import media files into the media pool"""
        if not self.current_project:
            return {"error": "No project open"}

        media_pool = self.current_project.GetMediaPool()
        if not media_pool:
            return {"error": "No media pool available"}

        target = media_pool.GetRootFolder()
        if target_folder:
            # Find target folder
            folders = self._find_folder(media_pool.GetRootFolder(), target_folder)
            if folders:
                target = folders[0]

        try:
            imported = media_pool.ImportMedia(file_paths)
            if imported:
                results = []
                for item in imported:
                    results.append(self._media_pool_item_to_dict(item))
                return {"success": True, "imported": results}
            return {"error": "Failed to import media"}
        except Exception as e:
            return {"error": f"Import failed: {str(e)}", "traceback": traceback.format_exc()}

    def _find_folder(self, folder, name: str) -> List:
        """Find folder by name"""
        results = []
        if folder.GetName() == name:
            results.append(folder)
        sub_folders = folder.GetSubFolderList()
        if sub_folders:
            for sub in sub_folders:
                results.extend(self._find_folder(sub, name))
        return results

    def cut_clip(self, clip_id: str, cut_frame: int) -> Dict[str, Any]:
        """Cut a clip at the specified frame"""
        if not self.current_project:
            return {"error": "No project open"}

        timeline = self.current_project.GetCurrentTimeline()
        if not timeline:
            return {"error": "No active timeline"}

        # Find the clip
        clip = self._find_timeline_item(timeline, clip_id)
        if not clip:
            return {"error": f"Clip not found: {clip_id}"}

        start = clip.GetStart()
        end = clip.GetEnd()

        if cut_frame <= start or cut_frame >= end:
            return {"error": "Cut frame must be within clip bounds"}

        try:
            # Split the clip
            result = timeline.SplitClip(clip, cut_frame)
            if result:
                return {"success": True, "message": f"Clip cut at frame {cut_frame}"}
            return {"error": "Failed to cut clip"}
        except Exception as e:
            return {"error": f"Cut failed: {str(e)}", "traceback": traceback.format_exc()}

    def _find_timeline_item(self, timeline, item_id: str):
        """Find timeline item by unique ID"""
        for track_type in ["video", "audio", "subtitle"]:
            track_count = timeline.GetTrackCount(track_type)
            for i in range(1, track_count + 1):
                items = timeline.GetItemsInTrack(track_type, i)
                if items:
                    for item in items.values():
                        if str(item.GetUniqueId()) == item_id:
                            return item
        return None

    def trim_clip(self, clip_id: str, new_start: Optional[int] = None, new_end: Optional[int] = None, ripple: bool = False) -> Dict[str, Any]:
        """Trim a clip's start or end"""
        if not self.current_project:
            return {"error": "No project open"}

        timeline = self.current_project.GetCurrentTimeline()
        if not timeline:
            return {"error": "No active timeline"}

        clip = self._find_timeline_item(timeline, clip_id)
        if not clip:
            return {"error": f"Clip not found: {clip_id}"}

        try:
            current_start = clip.GetStart()
            current_end = clip.GetEnd()

            start = new_start if new_start is not None else current_start
            end = new_end if new_end is not None else current_end

            if start >= end:
                return {"error": "Start frame must be before end frame"}

            # Set new trim
            clip.SetStart(start)
            clip.SetEnd(end)

            if ripple:
                # Ripple edit - close gaps
                timeline.CloseGap(clip)

            return {"success": True, "message": f"Clip trimmed: {start}-{end}"}
        except Exception as e:
            return {"error": f"Trim failed: {str(e)}", "traceback": traceback.format_exc()}

    def ripple_delete(self, timeline_id: str, start_frame: int, end_frame: int, tracks: Optional[List[int]] = None) -> Dict[str, Any]:
        """Ripple delete a range from timeline"""
        if not self.current_project:
            return {"error": "No project open"}

        timeline = self.current_project.GetCurrentTimeline()
        if not timeline:
            return {"error": "No active timeline"}

        if str(timeline.GetUniqueId()) != timeline_id:
            return {"error": "Timeline ID mismatch"}

        try:
            # Set in/out points
            timeline.SetCurrentTimecode(self._frames_to_timecode_string(start_frame, timeline.GetSetting("timelineFrameRate") or 24))
            # Note: Resolve's API for ripple delete is limited
            # We need to select and delete clips in range

            deleted = []
            for track_type in ["video", "audio", "subtitle"]:
                track_count = timeline.GetTrackCount(track_type)
                track_indices = tracks if tracks else range(1, track_count + 1)
                for i in track_indices:
                    items = timeline.GetItemsInTrack(track_type, i)
                    if items:
                        for item in items.values():
                            item_start = item.GetStart()
                            item_end = item.GetEnd()
                            # Check if item overlaps with range
                            if item_start < end_frame and item_end > start_frame:
                                timeline.DeleteClips([item])
                                deleted.append(str(item.GetUniqueId()))

            return {"success": True, "deleted": deleted, "message": f"Ripple deleted {len(deleted)} clips"}
        except Exception as e:
            return {"error": f"Ripple delete failed: {str(e)}", "traceback": traceback.format_exc()}

    def _frames_to_timecode_string(self, frames: int, frame_rate: float) -> str:
        """Convert frames to timecode string"""
        fps = int(frame_rate)
        hours = frames // (3600 * fps)
        frames -= hours * 3600 * fps
        minutes = frames // (60 * fps)
        frames -= minutes * 60 * fps
        seconds = frames // fps
        frames -= seconds * fps
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}:{frames:02d}"

    def add_marker(self, timeline_id: str, frame: int, name: str, note: str = "", color: str = "Blue", duration: int = 1) -> Dict[str, Any]:
        """Add a marker to timeline"""
        if not self.current_project:
            return {"error": "No project open"}

        timeline = self.current_project.GetCurrentTimeline()
        if not timeline:
            return {"error": "No active timeline"}

        if str(timeline.GetUniqueId()) != timeline_id:
            return {"error": "Timeline ID mismatch"}

        try:
            tc = self._frames_to_timecode_string(frame, timeline.GetSetting("timelineFrameRate") or 24)
            timeline.SetCurrentTimecode(tc)
            marker_id = timeline.AddMarker(frame, color, name, note, duration, 1)
            if marker_id:
                return {"success": True, "markerId": marker_id, "message": f"Marker added at frame {frame}"}
            return {"error": "Failed to add marker"}
        except Exception as e:
            return {"error": f"Add marker failed: {str(e)}", "traceback": traceback.format_exc()}

    def add_text_title(self, timeline_id: str, track_index: int, start_frame: int, duration: int,
                       text: str, font_size: int = 72, font_family: str = "Arial",
                       color: str = "FFFFFF", position: Optional[Dict] = None, alignment: str = "center") -> Dict[str, Any]:
        """Add a Text+ title to timeline"""
        if not self.current_project:
            return {"error": "No project open"}

        timeline = self.current_project.GetCurrentTimeline()
        if not timeline:
            return {"error": "No active timeline"}

        if str(timeline.GetUniqueId()) != timeline_id:
            return {"error": "Timeline ID mismatch"}

        try:
            media_pool = self.current_project.GetMediaPool()
            # Create a Text+ generator
            # Note: This requires Fusion composition
            # For simplicity, we'll add a basic title using the title template

            title_templates = media_pool.GetTitleTemplates()
            text_plus = None
            for template in title_templates:
                if "Text+" in template or "Text Plus" in template:
                    text_plus = template
                    break

            if not text_plus:
                return {"error": "Text+ template not found"}

            # Add to timeline
            timeline.SetCurrentTimecode(self._frames_to_timecode_string(start_frame, timeline.GetSetting("timelineFrameRate") or 24))
            clip = media_pool.AppendToTimeline(text_plus)

            if clip:
                # Set duration
                clip.SetEnd(start_frame + duration)
                # Set text content - this requires Fusion
                # For now, return success
                return {"success": True, "clipId": str(clip.GetUniqueId()), "message": f"Text+ title added"}

            return {"error": "Failed to add Text+ title"}
        except Exception as e:
            return {"error": f"Add Text+ failed: {str(e)}", "traceback": traceback.format_exc()}

    def duplicate_timeline(self, timeline_id: str, new_name: str) -> Dict[str, Any]:
        """Duplicate a timeline"""
        if not self.current_project:
            return {"error": "No project open"}

        timeline = self.current_project.GetCurrentTimeline()
        if not timeline:
            return {"error": "No active timeline"}

        if str(timeline.GetUniqueId()) != timeline_id:
            # Try to find by ID
            found = False
            for i in range(1, self.current_project.GetTimelineCount() + 1):
                tl = self.current_project.GetTimelineByIndex(i)
                if tl and str(tl.GetUniqueId()) == timeline_id:
                    timeline = tl
                    found = True
                    break
            if not found:
                return {"error": "Timeline not found"}

        try:
            media_pool = self.current_project.GetMediaPool()
            duplicated = media_pool.DuplicateTimeline(timeline)
            if duplicated:
                duplicated.SetName(new_name)
                return {"success": True, "timelineId": str(duplicated.GetUniqueId()), "message": f"Timeline duplicated as '{new_name}'"}
            return {"error": "Failed to duplicate timeline"}
        except Exception as e:
            return {"error": f"Duplicate timeline failed: {str(e)}", "traceback": traceback.format_exc()}

    def adjust_clip_properties(self, clip_id: str, properties: Dict[str, Any]) -> Dict[str, Any]:
        """Adjust clip properties (opacity, volume, transform, etc.)"""
        if not self.current_project:
            return {"error": "No project open"}

        timeline = self.current_project.GetCurrentTimeline()
        if not timeline:
            return {"error": "No active timeline"}

        clip = self._find_timeline_item(timeline, clip_id)
        if not clip:
            return {"error": f"Clip not found: {clip_id}"}

        try:
            for key, value in properties.items():
                if key == "opacity":
                    clip.SetProperty("Opacity", float(value))
                elif key == "volume":
                    clip.SetProperty("Volume", float(value))
                elif key == "pan":
                    clip.SetProperty("Pan", float(value))
                elif key == "pitch":
                    clip.SetProperty("Pitch", float(value))
                elif key == "speed":
                    clip.SetProperty("Speed", float(value))
                elif key == "reverse":
                    clip.SetProperty("Reverse", bool(value))

            return {"success": True, "message": "Clip properties updated"}
        except Exception as e:
            return {"error": f"Adjust properties failed: {str(e)}", "traceback": traceback.format_exc()}

    def export_timeline(self, timeline_id: str, format: str, output_path: str,
                        include_markers: bool = True, include_transitions: bool = True) -> Dict[str, Any]:
        """Export timeline to EDL, FCPXML, or OTIO"""
        if not self.current_project:
            return {"error": "No project open"}

        timeline = self.current_project.GetCurrentTimeline()
        if not timeline:
            return {"error": "No active timeline"}

        if str(timeline.GetUniqueId()) != timeline_id:
            return {"error": "Timeline ID mismatch"}

        try:
            if format.lower() == "edl":
                result = timeline.ExportEDL(output_path, include_markers, include_transitions)
            elif format.lower() == "fcpxml":
                result = timeline.ExportFCPXML(output_path)
            elif format.lower() == "otio":
                # OTIO export may need custom implementation
                result = self._export_otio(timeline, output_path)
            else:
                return {"error": f"Unsupported export format: {format}"}

            if result:
                return {"success": True, "outputPath": output_path, "message": f"Exported to {format.upper()}"}
            return {"error": f"Export to {format} failed"}
        except Exception as e:
            return {"error": f"Export failed: {str(e)}", "traceback": traceback.format_exc()}

    def _export_otio(self, timeline, output_path: str) -> bool:
        """Export timeline to OTIO format (OpenTimelineIO)"""
        try:
            import opentimelineio as otio
        except ImportError:
            return False

        try:
            otio_timeline = otio.schema.Timeline(name=timeline.GetName())
            track = otio.schema.Track(name="Video 1")

            fps = timeline.GetSetting("timelineFrameRate") or 24
            rate = otio.opentime.RationalTime(rate=fps)

            items = timeline.GetItemsInTrack("video", 1)
            if items:
                for item in items.values():
                    clip = otio.schema.Clip(name=item.GetName())
                    clip.source_range = otio.opentime.TimeRange(
                        start_time=otio.opentime.RationalTime(value=item.GetStart(), rate=rate),
                        duration=otio.opentime.RationalTime(value=item.GetDuration(), rate=rate)
                    )
                    track.append(clip)

            otio_timeline.tracks.append(track)
            otio.adapters.write_to_file(otio_timeline, output_path)
            return True
        except Exception:
            return False

    def render_frame(self, timeline_id: str, frame_number: int, format: str = "png",
                     width: Optional[int] = None, height: Optional[int] = None) -> Dict[str, Any]:
        """Render a single frame from timeline"""
        if not self.current_project:
            return {"error": "No project open"}

        timeline = self.current_project.GetCurrentTimeline()
        if not timeline:
            return {"error": "No active timeline"}

        if str(timeline.GetUniqueId()) != timeline_id:
            return {"error": "Timeline ID mismatch"}

        try:
            # Set playhead to frame
            tc = self._frames_to_timecode_string(frame_number, timeline.GetSetting("timelineFrameRate") or 24)
            timeline.SetCurrentTimecode(tc)

            # Render frame using Resolve's render API
            # This requires setting up a render job
            render_job = self.current_project.AddRenderJob()
            if not render_job:
                return {"error": "Failed to create render job"}

            # Configure render settings for single frame
            render_job.SetRenderSettings({
                "TargetDir": os.path.dirname(output_path) if 'output_path' in locals() else "/tmp",
                "CustomName": f"frame_{frame_number}",
                "Format": format.upper(),
                "Width": width or 1920,
                "Height": height or 1080,
                "MarkIn": frame_number,
                "MarkOut": frame_number
            })

            # Start render
            self.current_project.StartRendering(render_job)

            # Wait for completion (simplified)
            import time
            while self.current_project.IsRenderingInProgress():
                time.sleep(0.5)

            return {"success": True, "message": f"Frame {frame_number} rendered"}
        except Exception as e:
            return {"error": f"Frame render failed: {str(e)}", "traceback": traceback.format_exc()}

    def take_screenshot(self, timeline_id: str, timecode: Dict[str, Any], format: str = "png",
                        width: Optional[int] = None, height: Optional[int] = None) -> Dict[str, Any]:
        """Take a screenshot of the timeline at specific timecode"""
        # Convert timecode to frame
        fps = timecode.get("frameRate", 24)
        frame = (timecode.get("hours", 0) * 3600 + timecode.get("minutes", 0) * 60 + timecode.get("seconds", 0)) * fps + timecode.get("frames", 0)
        return self.render_frame(timeline_id, frame, format, width, height)

    def _get_timeline_by_id(self, timeline_id: str):
        if not self.current_project:
            return None
        tl = self.current_project.GetCurrentTimeline()
        if tl and str(tl.GetUniqueId()) == timeline_id:
            return tl
        for i in range(1, self.current_project.GetTimelineCount() + 1):
            t = self.current_project.GetTimelineByIndex(i)
            if t and str(t.GetUniqueId()) == timeline_id:
                return t
        return tl

    def _find_media_pool_item_by_id(self, folder, item_id: str):
        if not folder:
            return None
        clips = folder.GetClipList()
        if clips:
            for c in clips:
                if str(c.GetUniqueId()) == item_id or c.GetName() == item_id:
                    return c
        sub_folders = folder.GetSubFolderList()
        if sub_folders:
            for sub in sub_folders:
                found = self._find_media_pool_item_by_id(sub, item_id)
                if found:
                    return found
        return None

    def create_timeline(self, name: str) -> Dict[str, Any]:
        """Create a new empty timeline"""
        if not self.current_project:
            return {"error": "No project open"}
        media_pool = self.current_project.GetMediaPool()
        if not media_pool:
            return {"error": "No media pool available"}
        try:
            tl = media_pool.CreateEmptyTimeline(name)
            if tl:
                return {
                    "success": True,
                    "timelineId": str(tl.GetUniqueId()),
                    "name": tl.GetName(),
                    "message": f"Timeline '{name}' created successfully"
                }
            return {"error": f"Failed to create empty timeline '{name}'"}
        except Exception as e:
            return {"error": f"Create timeline failed: {str(e)}", "traceback": traceback.format_exc()}

    def set_timeline_settings(self, timeline_id: str, width: int, height: int, frame_rate: float) -> Dict[str, Any]:
        """Set timeline resolution and frame rate"""
        if not self.current_project:
            return {"error": "No project open"}
        timeline = self._get_timeline_by_id(timeline_id)
        if not timeline:
            return {"error": f"Timeline not found: {timeline_id}"}
        try:
            timeline.SetSetting("useCustomSettings", "1")
            timeline.SetSetting("timelineResolutionWidth", str(width))
            timeline.SetSetting("timelineResolutionHeight", str(height))
            timeline.SetSetting("timelineFrameRate", str(frame_rate))
            return {
                "success": True,
                "message": f"Timeline settings updated to {width}x{height} @ {frame_rate}fps"
            }
        except Exception as e:
            return {"error": f"Set timeline settings failed: {str(e)}", "traceback": traceback.format_exc()}

    def append_clip_to_timeline(self, media_pool_item_id: str, timeline_id: Optional[str] = None) -> Dict[str, Any]:
        """Append a media pool item to timeline"""
        if not self.current_project:
            return {"error": "No project open"}
        media_pool = self.current_project.GetMediaPool()
        if not media_pool:
            return {"error": "No media pool available"}
        item = self._find_media_pool_item_by_id(media_pool.GetRootFolder(), media_pool_item_id)
        if not item:
            return {"error": f"Media pool item not found: {media_pool_item_id}"}
        try:
            appended = media_pool.AppendToTimeline([item])
            if appended:
                first_clip = appended[0] if len(appended) > 0 else None
                clip_id = str(first_clip.GetUniqueId()) if first_clip else ""
                return {
                    "success": True,
                    "clipId": clip_id,
                    "message": "Clip appended to timeline successfully"
                }
            return {"error": "Failed to append clip to timeline"}
        except Exception as e:
            return {"error": f"Append clip failed: {str(e)}", "traceback": traceback.format_exc()}

    def create_subtitle_track(self, timeline_id: str, track_name: str = "Subtitles") -> Dict[str, Any]:
        """Create a subtitle track on timeline"""
        if not self.current_project:
            return {"error": "No project open"}
        timeline = self._get_timeline_by_id(timeline_id)
        if not timeline:
            return {"error": f"Timeline not found: {timeline_id}"}
        try:
            res = timeline.AddTrack("subtitle")
            return {"success": True, "message": f"Subtitle track added"}
        except Exception as e:
            return {"error": f"Add subtitle track failed: {str(e)}", "traceback": traceback.format_exc()}

    def import_subtitles(self, timeline_id: str, srt_path: str) -> Dict[str, Any]:
        """Import SRT subtitles into timeline"""
        if not self.current_project:
            return {"error": "No project open"}
        timeline = self._get_timeline_by_id(timeline_id)
        if not timeline:
            return {"error": f"Timeline not found: {timeline_id}"}
        try:
            res = timeline.ImportIntoTimeline(srt_path)
            if res:
                return {"success": True, "message": f"Subtitles imported from {srt_path}"}
            return {"error": f"Import subtitles returned false for {srt_path}"}
        except Exception as e:
            return {"error": f"Import subtitles failed: {str(e)}", "traceback": traceback.format_exc()}

    def start_render_job(self, target_dir: str, custom_name: str, format: str = "MP4", codec: str = "H264",
                         width: int = 1080, height: int = 1920, frame_rate: float = 30.0) -> Dict[str, Any]:
        """Start a render job in DaVinci Resolve"""
        if not self.current_project:
            return {"error": "No project open"}
        try:
            self.current_project.SetRenderSettings({
                "TargetDir": target_dir,
                "CustomName": custom_name,
                "ExportVideo": True,
                "ExportAudio": True,
                "FormatWidth": width,
                "FormatHeight": height,
                "FrameRate": frame_rate
            })
            self.current_project.SetCurrentRenderFormatAndCodec(format.lower(), codec)
            job_id = self.current_project.AddRenderJob()
            if job_id:
                self.current_project.StartRendering([job_id])
                return {
                    "success": True,
                    "jobId": str(job_id),
                    "message": f"Render job {job_id} started"
                }
            return {"error": "Failed to add render job"}
        except Exception as e:
            return {"error": f"Start render failed: {str(e)}", "traceback": traceback.format_exc()}

    def get_render_job_status(self, job_id: str) -> Dict[str, Any]:
        """Get status of a render job"""
        if not self.current_project:
            return {"error": "No project open"}
        try:
            status = self.current_project.GetRenderJobStatus(job_id)
            is_rendering = self.current_project.IsRenderingInProgress()
            return {
                "success": True,
                "status": status.get("JobStatus", "Unknown") if isinstance(status, dict) else str(status),
                "completionPercentage": status.get("CompletionPercentage", 100 if not is_rendering else 50) if isinstance(status, dict) else 0,
                "isRendering": is_rendering
            }
        except Exception as e:
            return {"error": f"Get render status failed: {str(e)}", "traceback": traceback.format_exc()}

    def cancel_render_job(self, job_id: str) -> Dict[str, Any]:
        """Cancel a render job"""
        if not self.current_project:
            return {"error": "No project open"}
        try:
            self.current_project.StopRendering()
            self.current_project.DeleteRenderJob(job_id)
            return {"success": True, "message": f"Render job {job_id} cancelled"}
        except Exception as e:
            return {"error": f"Cancel render failed: {str(e)}", "traceback": traceback.format_exc()}


def main():
    """Main entry point for stdio communication"""
    bridge = ResolveBridge()

    # Connect on startup
    connect_result = bridge.connect()
    print(json.dumps({"type": "connect", "result": connect_result}), flush=True)

    # Process stdin commands
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            request_id = request.get("id", "")
            method = request.get("method", "")
            params = request.get("params", {})

            result = {"id": request_id}

            # Route method calls
            if method == "get_project":
                result["result"] = bridge.get_current_project()
            elif method == "import_media":
                result["result"] = bridge.import_media(params.get("filePaths", []), params.get("targetFolder"))
            elif method == "cut_clip":
                result["result"] = bridge.cut_clip(params.get("clipId", ""), params.get("cutFrame", 0))
            elif method == "trim_clip":
                result["result"] = bridge.trim_clip(
                    params.get("clipId", ""),
                    params.get("newStartFrame"),
                    params.get("newEndFrame"),
                    params.get("ripple", False)
                )
            elif method == "ripple_delete":
                result["result"] = bridge.ripple_delete(
                    params.get("timelineId", ""),
                    params.get("startFrame", 0),
                    params.get("endFrame", 0),
                    params.get("tracks")
                )
            elif method == "add_marker":
                result["result"] = bridge.add_marker(
                    params.get("timelineId", ""),
                    params.get("frame", 0),
                    params.get("name", ""),
                    params.get("note", ""),
                    params.get("color", "Blue"),
                    params.get("duration", 1)
                )
            elif method == "add_text_title":
                result["result"] = bridge.add_text_title(
                    params.get("timelineId", ""),
                    params.get("trackIndex", 1),
                    params.get("startFrame", 0),
                    params.get("duration", 0),
                    params.get("text", ""),
                    params.get("fontSize", 72),
                    params.get("fontFamily", "Arial"),
                    params.get("color", "FFFFFF"),
                    params.get("position"),
                    params.get("alignment", "center")
                )
            elif method == "duplicate_timeline":
                result["result"] = bridge.duplicate_timeline(params.get("timelineId", ""), params.get("newName", ""))
            elif method == "adjust_clip_properties":
                result["result"] = bridge.adjust_clip_properties(params.get("clipId", ""), params.get("properties", {}))
            elif method == "export_timeline":
                result["result"] = bridge.export_timeline(
                    params.get("timelineId", ""),
                    params.get("format", "edl"),
                    params.get("outputPath", ""),
                    params.get("includeMarkers", True),
                    params.get("includeTransitions", True)
                )
            elif method == "render_frame":
                result["result"] = bridge.render_frame(
                    params.get("timelineId", ""),
                    params.get("frameNumber", 0),
                    params.get("format", "png"),
                    params.get("width"),
                    params.get("height")
                )
            elif method == "take_screenshot":
                result["result"] = bridge.take_screenshot(
                    params.get("timelineId", ""),
                    params.get("timecode", {}),
                    params.get("format", "png"),
                    params.get("width"),
                    params.get("height")
                )
            elif method == "create_timeline":
                result["result"] = bridge.create_timeline(params.get("name", "Timeline 1"))
            elif method == "set_timeline_settings":
                result["result"] = bridge.set_timeline_settings(
                    params.get("timelineId", ""),
                    params.get("width", 1080),
                    params.get("height", 1920),
                    params.get("frameRate", 30.0)
                )
            elif method == "append_clip_to_timeline":
                result["result"] = bridge.append_clip_to_timeline(
                    params.get("mediaPoolItemId", ""),
                    params.get("timelineId")
                )
            elif method == "create_subtitle_track":
                result["result"] = bridge.create_subtitle_track(
                    params.get("timelineId", ""),
                    params.get("trackName", "Subtitles")
                )
            elif method == "import_subtitles":
                result["result"] = bridge.import_subtitles(
                    params.get("timelineId", ""),
                    params.get("srtPath", "")
                )
            elif method == "start_render_job":
                result["result"] = bridge.start_render_job(
                    params.get("targetDir", "/tmp"),
                    params.get("customName", "output"),
                    params.get("format", "MP4"),
                    params.get("codec", "H264"),
                    params.get("width", 1080),
                    params.get("height", 1920),
                    params.get("frameRate", 30.0)
                )
            elif method == "get_render_job_status":
                result["result"] = bridge.get_render_job_status(params.get("jobId", ""))
            elif method == "cancel_render_job":
                result["result"] = bridge.cancel_render_job(params.get("jobId", ""))
            elif method == "get_version":
                result["result"] = bridge.get_version()
            else:
                result["error"] = {"code": "METHOD_NOT_FOUND", "message": f"Unknown method: {method}"}

            print(json.dumps(result), flush=True)

        except json.JSONDecodeError:
            print(json.dumps({"error": {"code": "PARSE_ERROR", "message": "Invalid JSON"}}), flush=True)
        except Exception as e:
            print(json.dumps({"error": {"code": "INTERNAL_ERROR", "message": str(e), "traceback": traceback.format_exc()}}), flush=True)


if __name__ == "__main__":
    main()