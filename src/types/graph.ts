export interface NoteItem {
  text: string
  at: number
}

export interface FileInfo {
  name: string
  size: number
  mtime: number
  kind: 'file' | 'dir'
}

export interface CanvasMeta {
  id: string
  name: string
  createdAt: number
}

export interface ActiveCanvas {
  kind: 'dir' | 'canvas'
  /** kind='dir' 时是文件夹绝对路径；kind='canvas' 时是画布 id */
  id: string
}

export interface ExternalStatus {
  exists: boolean
  size?: number
  mtime?: number
  kind?: 'file' | 'dir'
}

export interface GraphNode {
  id: string
  fileName: string | null
  label?: string
  /** 自由画布上的外部引用节点：受管文件夹之外的绝对路径 */
  externalPath?: string
  x: number
  y: number
  placeholder: boolean
  notes: NoteItem[]
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  relation: string
  note: string
  at: number
}

/** 分组框：画布上的圆角矩形区域，坐标与节点同一坐标系 */
export interface GraphFrame {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 旧数据没有 frames 字段，读取时按 [] 处理 */
  frames?: GraphFrame[]
}

/** /api/import 返回的写入结果：path 为受管文件夹内的绝对路径（自由画布用它建引用节点） */
export interface ImportedFile extends FileInfo {
  path: string
}

export interface StateResponse {
  dir: string
  recentDirs: string[]
  canvases: CanvasMeta[]
  activeCanvas: ActiveCanvas
  files: FileInfo[]
  graph: Graph
  externalStatus: Record<string, ExternalStatus>
}

/** React Flow 文件节点携带的数据 */
export interface FileNodeData {
  fileName: string | null
  label?: string
  /** 外部引用节点的绝对路径（此时 fileName 为 null，label 为显示名） */
  externalPath?: string
  placeholder: boolean
  notes: NoteItem[]
  lost?: boolean
  size?: number
  mtime?: number
  kind?: 'file' | 'dir'
  auto?: boolean
}

/** React Flow 边携带的数据 */
export interface EdgeData {
  relation: string
  note: string
  at: number
}
