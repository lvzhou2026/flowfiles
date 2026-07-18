import type { GraphFrame } from '@/types/graph'

/** 与 FileNode 渲染尺寸大致一致的节点占位尺寸（用于分组框贴合与自动布局） */
export const NODE_W = 230
export const NODE_H = 96

export const FRAME_PAD_X = 16
export const FRAME_PAD_TOP = 34
export const FRAME_PAD_BOTTOM = 14

export const FRAME_MIN_W = 140
export const FRAME_MIN_H = 90

export type FrameRect = Pick<GraphFrame, 'x' | 'y' | 'w' | 'h'>

/** 节点中心点是否落在框内（分组框的成员判定规则） */
export function frameContains(f: FrameRect, cx: number, cy: number): boolean {
  return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h
}

/** 自动贴合：包住给定节点集合的最小分组框（含内边距） */
export function frameFit(positions: { x: number; y: number }[]): FrameRect {
  const minX = Math.min(...positions.map((p) => p.x))
  const minY = Math.min(...positions.map((p) => p.y))
  const maxX = Math.max(...positions.map((p) => p.x + NODE_W))
  const maxY = Math.max(...positions.map((p) => p.y + NODE_H))
  return {
    x: Math.round(minX - FRAME_PAD_X),
    y: Math.round(minY - FRAME_PAD_TOP),
    w: Math.round(maxX - minX + FRAME_PAD_X * 2),
    h: Math.round(maxY - minY + FRAME_PAD_TOP + FRAME_PAD_BOTTOM),
  }
}

/** 布局变化后，分组框跟随其包含节点重新定位；空框保持原位 */
export function relayoutFrames(
  frames: GraphFrame[],
  nodePositions: { id: string; x: number; y: number }[],
): GraphFrame[] {
  return frames.map((f) => {
    const inside = nodePositions.filter((n) =>
      frameContains(f, n.x + NODE_W / 2, n.y + NODE_H / 2),
    )
    if (inside.length === 0) return f
    return { ...f, ...frameFit(inside) }
  })
}

/**
 * 分层自动布局（不依赖 dagre）：
 * - 按边做 Kahn 拓扑分层：入度为 0 的节点在第 0 列，逐层向右
 * - 有环时环内剩余节点按顺序追加到最后一层（BFS 兜底）
 * - 互不连通的孤立节点在最右侧按网格排列
 */
export function layeredPositions(
  nodes: { id: string }[],
  edges: { from: string; to: string }[],
): Map<string, { x: number; y: number }> {
  const GAP_X = 320
  const GAP_Y = 170
  const GRID_COLS = 3
  const X0 = 60
  const Y0 = 60

  const ids = nodes.map((n) => n.id)
  const idSet = new Set(ids)
  const out = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const id of ids) {
    out.set(id, [])
    indeg.set(id, 0)
  }
  const linked = new Set<string>()
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue
    linked.add(e.from)
    linked.add(e.to)
    if (e.from === e.to) continue
    out.get(e.from)!.push(e.to)
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  }

  // Kahn 拓扑分层
  const layer = new Map<string, number>()
  const deg = new Map(indeg)
  let frontier = ids.filter((id) => linked.has(id) && (deg.get(id) ?? 0) === 0)
  let depth = 0
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      if (layer.has(id)) continue
      layer.set(id, depth)
      for (const to of out.get(id) ?? []) {
        const d = (deg.get(to) ?? 0) - 1
        deg.set(to, d)
        if (d === 0 && !layer.has(to)) next.push(to)
      }
    }
    frontier = next
    depth++
  }
  // 环内剩余节点：追加到最后一层
  for (const id of ids) {
    if (linked.has(id) && !layer.has(id)) layer.set(id, depth)
  }

  const connected = ids.filter((id) => linked.has(id))
  const maxLayer = connected.length
    ? Math.max(...connected.map((id) => layer.get(id) ?? 0))
    : -1
  const byLayer = new Map<number, string[]>()
  for (const id of connected) {
    const l = layer.get(id) ?? 0
    byLayer.set(l, [...(byLayer.get(l) ?? []), id])
  }

  const pos = new Map<string, { x: number; y: number }>()
  for (const [l, list] of byLayer) {
    list.forEach((id, i) => pos.set(id, { x: X0 + l * GAP_X, y: Y0 + i * GAP_Y }))
  }
  // 孤立节点：最右侧网格
  const isolated = ids.filter((id) => !linked.has(id))
  const isoX = X0 + (maxLayer + 1) * GAP_X
  isolated.forEach((id, i) =>
    pos.set(id, {
      x: isoX + (i % GRID_COLS) * GAP_X,
      y: Y0 + Math.floor(i / GRID_COLS) * GAP_Y,
    }),
  )
  return pos
}

export type FileCategory = 'doc' | 'image' | 'sheet' | 'folder'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic'])
const SHEET_EXTS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'json'])

/** 节点类型归类（筛选器用）；占位节点由调用方先行判断 */
export function nodeCategory(data: {
  kind?: 'file' | 'dir'
  fileName?: string | null
  label?: string
}): FileCategory {
  if (data.kind === 'dir') return 'folder'
  const name = data.fileName ?? data.label ?? ''
  const i = name.lastIndexOf('.')
  const ext = i >= 0 ? name.slice(i + 1).toLowerCase() : ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (SHEET_EXTS.has(ext)) return 'sheet'
  return 'doc'
}
