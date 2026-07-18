**[中文](README.md) | [English](README.en.md)**

# FlowFiles · Node-Canvas File Manager (v0.3 Web Prototype)

**The canvas IS the folder**: point FlowFiles at a local folder and every file inside is automatically laid out as a node on an infinite canvas. You can drag nodes to arrange them, draw links between files to record relationships (Iteration / Reference / Related) with notes, click a node to jump to the real file, and create placeholder nodes for files that don't exist yet — then fill them in later.

Since v0.2 it supports a **hybrid canvas model**: besides folder-bound canvases, you can create **free canvases** that don't belong to any folder, placing files from anywhere on disk as external reference nodes and organizing relationships across folders.

v0.3 adds **second-tier canvas powers**: group frames (lasso-grouping / whole-group dragging), Cmd+F search-and-jump, type filters and "show only related", a topological layered auto-layout, left-drag multi-select with batch operations, and drag-from-Finder onto free canvases (copies the file into the managed folder and references it).

This prototype validates the full interaction model; it will later be packaged as a native Mac app with Tauri.

## Getting Started

```bash
npm install
npm run dev -- --port 7100
```

Single-process architecture: a custom Vite plugin in `vite.config.ts` serves the `/api/*` REST endpoints directly through `server.middlewares` (Node `fs` / `child_process`) — no separate backend. The port is passed through from the CLI (Vite supports `--port` natively; no strictPort is hardcoded).

On first launch, a `demo-folder/` (6 sample files) is created as the default managed folder, and an initial canvas is seeded (5 file nodes + 4 relation links + 1 placeholder node `launch-checklist`).

## Hybrid Canvas Model

- **Folder canvas**: bound to one managed folder; its contents are laid out as nodes in real time. The left sidebar's "Folder canvases" section lists recently used folders (up to 10) — click to switch.
- **Free canvas**: a blank canvas bound to no folder; can be created / renamed / deleted. Nodes can reference any file outside the managed folder (`externalPath`, absolute path). When an external file disappears, its node is grayed out and marked "Lost"; the sidebar offers "Relocate by file name" (searches recent folders).
- While a free canvas is active, `/api/state` still returns the current managed folder's files (so placeholder nodes can "associate an existing file"), but new files are NOT auto-placed onto the canvas.
- **Drop semantics on free canvases (v0.3)**: dragging a file from Finder onto a free canvas = copy it into the current managed folder first, then place an `externalPath` reference node (pointing at the new copy) directly at the drop point, without waiting for polling. Drop behavior on folder canvases is unchanged.

`graph.json` key rules: folder canvases use `dir:<absolute path>`, free canvases use `canvas:<id>`; **backward compatible**: legacy keys without a prefix are treated as folder paths (auto-fallback on read, migrated on write).

## Data Persistence

- `server-data/config.json` — `{ dir, recentDirs[], activeCanvas }`; the legacy format (only `dir`) is auto-migrated on read
- `server-data/canvases.json` — `{ canvases: [{ id, name, createdAt }] }`
- `server-data/graph.json` — stores each canvas's graph (node positions / notes / external references, links / relations / notes, and `frames[]` group frames) under the key rules above; missing `frames` defaults to `[]`
- New files appear automatically at a free grid spot; positions are only written to the graph after the user drags a node

## v0.3 Canvas Powers

- **Group frames**: `frames: [{id, name, x, y, w, h}]` persisted with the graph. Multi-select nodes and use the batch toolbar's "Group" to auto-fit a frame; "New group frame" places an empty frame at the viewport center. Drag the title bar to move the whole group (nodes whose centers are inside follow), double-click the title to rename, delete from the top-right corner (deletes the frame only), resize from the bottom-right handle. Implemented as an independent absolutely-positioned layer — no reactflow parentNode
- **Search & jump**: `Cmd/Ctrl+F` opens a search overlay (browser default search is preventDefault-ed), live-matching node file names / node notes / link notes; picking a result smoothly centers and selects the target (Esc closes)
- **Filters**: toolbar chips (All / Docs / Images / Tables / Folders / Placeholders) hide non-matching nodes and their edges via reactflow's `hidden` — no data is deleted; with a node selected, "Show only related" keeps only that node plus its directly connected nodes and edges
- **Auto-layout**: self-built topological layered layout (no dagre dependency) — zero-in-degree nodes go in column 0, layers extend rightward; cyclic leftovers fall back to the last column; isolated nodes go to a grid on the far right; group frames re-fit to their contained nodes; auto-fitView after applying
- **Multi-select & batch ops**: `selectionOnDrag` + `panOnDrag={[1, 2]}` (left-drag lasso, middle/right-drag pan, Shift to add); with ≥2 selected, a floating batch toolbar appears: Group / Align left / Align top / Remove from canvas (batch; removes nodes only, never touches files)

## Feature List

- **Canvas**: React Flow + dotted background; custom nodes show a type icon by extension (md=doc / csv=table / png=image etc.), file name, size / modified time, and a note-count badge
- **Image thumbnails**: image nodes show a thumbnail at the top of the card (90px, object-cover)
- **Live sync**: the frontend polls every 3 seconds; new files in the folder appear on the canvas automatically; externally deleted files are grayed out and marked "Lost"
- **Drag to arrange**: positions are saved with a 500ms debounce after dragging
- **Draw links**: drag from one node's handle to another, then pick a relation type (Iteration / Reference / Related) + note in the dialog; Iteration = solid line, Reference / Related = dashed; the link label shows the relation word with the note below it
- **Node deletion**: `Backspace` / `Delete` or the sidebar's "Remove from canvas" = removes the node only, never the file; "Move to Trash" asks for confirmation and deletes the file via Finder (recoverable from the Trash)
- **Drag from Finder**: dropping a file onto the canvas copies it into the managed folder and places it at the drop point (duplicates get a `-1` suffix); on free canvases it is copied into the managed folder and placed as a reference node
- **Space-bar preview**: select a node and press Space for a quick preview (large image / native PDF rendering / first 800 characters of text / file info for other types); not triggered while typing or when a dialog is open. Will be replaced by native macOS QuickLook in the Tauri phase
- **Detail sidebar**:
  - File node: preview area (image / PDF / text), file info, note list, "Open file", "Reveal in Finder", "Remove from canvas", "Move to Trash"
  - External reference node: full path with an "External reference" badge; "Relocate by file name" when the link is broken
  - Placeholder node (dashed border + "Pending file" tag): edit the target file name → "Create file and associate", or associate an existing not-yet-on-canvas file from a dropdown
  - Link: shows relation type + note; note is editable; link can be deleted
- **Left canvas sidebar**: "Folder canvases" (recent folders, current highlighted) + "Free canvases" (create / rename / delete, with confirmation)
- **Top bar**: current path or free canvas name, "Change folder", "+ New placeholder node", file count

## API Reference

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/state` | `{ dir, recentDirs, canvases, activeCanvas, files[], graph, externalStatus }`; files are scanned live from the current managed folder |
| POST | `/api/dir` | `{dir}` switches the managed folder and pushes it into recentDirs; returns the new state |
| POST | `/api/graph` | Saves the active canvas's nodes + edges (called by the frontend with a 500ms debounce) |
| POST | `/api/canvas` | `{name}` creates a free canvas and switches to it |
| POST | `/api/canvas/switch` | `{kind, id}` switches canvas; when kind='dir', id is a folder path (also updates dir / recentDirs) |
| POST | `/api/canvas/rename` | `{id, name}` renames a free canvas |
| POST | `/api/canvas/delete` | `{id}` deletes a free canvas and its graph; falls back to the current dir canvas if it was active |
| POST | `/api/open` | `{fileName}` (inside managed folder) or `{path}` (external absolute path); opens with `open` |
| POST | `/api/reveal` | Same targets; reveals in Finder via `open -R` |
| POST | `/api/locate` | `{fileName}` searches recentDirs (incl. current dir) one level deep; returns `{path}` or 404 |
| POST | `/api/trash` | `{fileName}` moves the file to the Trash via osascript + Finder (path validation enforced) |
| POST | `/api/import` | multipart upload; writes into the current managed folder (duplicates get a `-1` suffix); returned items include the absolute `path`; also accepted on free canvases (frontend builds reference nodes from `path`) |
| GET | `/api/thumb` | `?name=` or `?path=` returns raw file bytes (png/jpg/jpeg/gif/webp/svg/bmp/pdf); `path` must be an external reference registered on the current canvas |
| GET | `/api/preview` | `?name=` or `?path=` returns the first 800 characters of text files as JSON `{text, truncated}` |
| POST | `/api/materialize` | `{fileName}` creates an empty file in the managed folder (409 if it exists) |

Security: for open / reveal / trash / materialize / import, managed paths are resolved with `path.resolve` and verified to stay inside the managed folder; `/api/thumb` and `/api/preview` only accept `?path=` values that are external references registered on the current canvas, preventing arbitrary file reads.

## Verification

`bash scripts/verify-dev.sh` temporarily starts the dev server, curl-checks every API endpoint (including 409 / 400 edge cases), then stops the server and restores test changes.

`bash scripts/verify-v03.sh` verifies the v0.3 additions: frames round-trip persistence (including invalid-data sanitization), `/api/import` returning absolute paths on free canvases, and thumbnail / text-preview regressions; it also starts/stops a temporary dev server and cleans up test artifacts.

## Tauri Packaging Plan

- Frontend: `npm run build` outputs to `dist/`; Tauri can point at the static frontend directly
- Backend: port the middleware logic of `server/api.ts` into Tauri commands (Rust `std::fs` / `std::process::Command` for open / reveal / trash / import), or keep a local sidecar HTTP service in the short term
- The Space-bar preview dialog will be replaced by native macOS QuickLook (QLPreviewPanel); a TODO comment is already in place
- `open` / `open -R` are native on macOS; Tauri-side equivalents like the `opener` / `reveal-item-in-dir` crates also work
- The JSON persistence for graph / config / canvases can migrate to `app_data_dir()`

## Tech Stack

React 19 + TypeScript + Vite 7 + React Flow 11 + Tailwind CSS 3 + shadcn/ui + lucide-react + sonner
