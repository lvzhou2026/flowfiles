import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  AlignStartHorizontal,
  AlignStartVertical,
  BoxSelect,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderSync,
  LayoutDashboard,
  Link2,
  Search,
  Wand2,
  X,
} from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { api, type OpenTarget } from '@/lib/api'
import type {
  ActiveCanvas,
  CanvasMeta,
  ExternalStatus,
  FileInfo,
  FileNodeData,
  Graph,
  GraphFrame,
  StateResponse,
} from '@/types/graph'
import { baseName } from '@/lib/format'
import { relationStyle } from '@/lib/relations'
import { cn } from '@/lib/utils'
import {
  FRAME_MIN_H,
  FRAME_MIN_W,
  NODE_H,
  NODE_W,
  frameContains,
  frameFit,
  layeredPositions,
  nodeCategory,
  relayoutFrames,
} from '@/lib/graph-utils'
import FileNode from '@/components/FileNode'
import FrameLayer from '@/components/FrameLayer'
import RelationEdge from '@/components/RelationEdge'
import RelationDialog from '@/components/RelationDialog'
import DetailSidebar, { type FEdge, type FNode } from '@/components/DetailSidebar'
import CanvasSidebar from '@/components/CanvasSidebar'
import QuickLookDialog from '@/components/QuickLookDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const nodeTypes = { flowFile: FileNode }
const edgeTypes = { relation: RelationEdge }

/** 把 React Flow 状态转成可持久化的 Graph；auto（未被用户确认摆位）的节点不入库 */
function toGraph(nodes: FNode[], edges: FEdge[]): Graph {
  return {
    nodes: nodes
      .filter((n) => !n.data.auto)
      .map((n) => ({
        id: n.id,
        fileName: n.data.fileName,
        ...(n.data.label ? { label: n.data.label } : {}),
        ...(n.data.externalPath ? { externalPath: n.data.externalPath } : {}),
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        placeholder: n.data.placeholder,
        notes: n.data.notes,
      })),
    edges: edges.map((e) => ({
      id: e.id,
      from: e.source,
      to: e.target,
      relation: e.data?.relation ?? '相关',
      note: e.data?.note ?? '',
      at: e.data?.at ?? Date.now(),
    })),
  }
}

function edgeVisual(relation: string) {
  const s = relationStyle(relation)
  return {
    type: 'relation' as const,
    style: { stroke: s.stroke, strokeWidth: s.width, strokeDasharray: s.dash },
    markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke, width: 16, height: 16 },
  }
}

/** 在已占用节点之外找一个空闲网格位 */
function freeSpot(nodes: FNode[]): { x: number; y: number } {
  const W = 290
  const H = 190
  const X0 = 60
  const Y0 = 60
  const COLS = 4
  for (let i = 0; ; i++) {
    const x = X0 + (i % COLS) * W
    const y = Y0 + Math.floor(i / COLS) * H
    const occupied = nodes.some(
      (n) => Math.abs(n.position.x - x) < W * 0.6 && Math.abs(n.position.y - y) < H * 0.6,
    )
    if (!occupied) return { x, y }
  }
}

/** 节点的打开/预览目标：受管文件走 fileName，外部引用走绝对路径 */
function nodeTarget(n: FNode): OpenTarget | null {
  if (n.data.fileName) return { fileName: n.data.fileName }
  if (n.data.externalPath) return { path: n.data.externalPath }
  return null
}

// ---------- 筛选器 ----------

type TypeFilter = 'all' | 'doc' | 'image' | 'sheet' | 'folder' | 'placeholder'

const TYPE_CHIPS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'doc', label: '文档' },
  { key: 'image', label: '图片' },
  { key: 'sheet', label: '表格' },
  { key: 'folder', label: '文件夹' },
  { key: 'placeholder', label: '占位' },
]

// ---------- 搜索 ----------

interface SearchHit {
  kind: 'node' | 'edge'
  id: string
  title: string
  snippet: string
}

/** 在文本里找命中片段（前后各带一点上下文），未命中返回 null */
function findSnippet(text: string, q: string): string | null {
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return null
  const start = Math.max(0, i - 12)
  const end = Math.min(text.length, i + q.length + 24)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function HomeInner() {
  const rf = useReactFlow()

  const [dir, setDir] = useState('')
  const [recentDirs, setRecentDirs] = useState<string[]>([])
  const [canvases, setCanvases] = useState<CanvasMeta[]>([])
  const [activeCanvas, setActiveCanvas] = useState<ActiveCanvas>({ kind: 'dir', id: '' })
  const [files, setFiles] = useState<FileInfo[]>([])
  const [nodes, setNodes] = useState<FNode[]>([])
  const [edges, setEdges] = useState<FEdge[]>([])
  const [sel, setSel] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null)

  const [pendingConn, setPendingConn] = useState<Connection | null>(null)
  const [dirDialogOpen, setDirDialogOpen] = useState(false)
  const [dirDraft, setDirDraft] = useState('')
  const [dirError, setDirError] = useState('')
  const [phDialogOpen, setPhDialogOpen] = useState(false)
  const [phName, setPhName] = useState('')
  const [extDialogOpen, setExtDialogOpen] = useState(false)
  const [extPath, setExtPath] = useState('')
  const [extError, setExtError] = useState('')
  const [quickLookId, setQuickLookId] = useState<string | null>(null)
  const [frames, setFrames] = useState<GraphFrame[]>([])
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [relatedOnly, setRelatedOnly] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const nodesRef = useRef<FNode[]>([])
  const edgesRef = useRef<FEdge[]>([])
  const framesRef = useRef<GraphFrame[]>([])
  const selRef = useRef(sel)
  const activeCanvasRef = useRef(activeCanvas)
  const searchOpenRef = useRef(searchOpen)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const saveTimer = useRef<number | null>(null)
  const readyRef = useRef(false)
  const dropRef = useRef<HTMLDivElement | null>(null)
  /** 会话级"用户主动移除"的文件名：防止轮询把它们当新文件重新自动上画布 */
  const removedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])
  useEffect(() => {
    edgesRef.current = edges
  }, [edges])
  useEffect(() => {
    framesRef.current = frames
  }, [frames])
  useEffect(() => {
    searchOpenRef.current = searchOpen
  }, [searchOpen])
  useEffect(() => {
    selRef.current = sel
  }, [sel])
  useEffect(() => {
    activeCanvasRef.current = activeCanvas
  }, [activeCanvas])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      api
        .saveGraph({ ...toGraph(nodesRef.current, edgesRef.current), frames: framesRef.current })
        .catch((e) => console.error('保存画布失败', e))
    }, 500)
  }, [])

  /** 由一份完整 state 重建画布（初始化 / 切换画布时调用） */
  const applyFullState = useCallback((s: StateResponse) => {
    // 切换画布时丢弃未发出的保存，避免把旧画布写进新画布的 key
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    removedRef.current.clear()
    setDir(s.dir)
    setFiles(s.files)
    setRecentDirs(s.recentDirs)
    setCanvases(s.canvases)
    setActiveCanvas(s.activeCanvas)
    const fileMap = new Map(s.files.map((f) => [f.name, f]))
    const base: FNode[] = s.graph.nodes.map((n) => {
      if (n.externalPath) {
        const st: ExternalStatus | undefined = s.externalStatus[n.externalPath]
        return {
          id: n.id,
          type: 'flowFile',
          position: { x: n.x, y: n.y },
          data: {
            fileName: null,
            label: n.label ?? baseName(n.externalPath),
            externalPath: n.externalPath,
            placeholder: n.placeholder,
            notes: n.notes,
            lost: !st?.exists,
            size: st?.size,
            mtime: st?.mtime,
            kind: st?.kind,
          },
        }
      }
      const f = n.fileName ? fileMap.get(n.fileName) : undefined
      return {
        id: n.id,
        type: 'flowFile',
        position: { x: n.x, y: n.y },
        data: {
          fileName: n.fileName,
          label: n.label,
          placeholder: n.placeholder,
          notes: n.notes,
          lost: !!n.fileName && !f,
          size: f?.size,
          mtime: f?.mtime,
          kind: f?.kind,
        },
      }
    })
    // 文件夹画布：文件夹里有、但 graph 里还没有的文件 → 自动节点；自由画布不自动铺文件
    const added: FNode[] = []
    if (s.activeCanvas.kind === 'dir') {
      const onCanvas = new Set(base.map((n) => n.data.fileName).filter(Boolean))
      for (const f of s.files) {
        if (onCanvas.has(f.name)) continue
        const spot = freeSpot([...base, ...added])
        added.push({
          id: `file:${f.name}`,
          type: 'flowFile',
          position: spot,
          data: {
            fileName: f.name,
            placeholder: false,
            notes: [],
            size: f.size,
            mtime: f.mtime,
            kind: f.kind,
            auto: true,
          },
        })
      }
    }
    setNodes([...base, ...added])
    setEdges(
      s.graph.edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        data: { relation: e.relation, note: e.note, at: e.at },
        ...edgeVisual(e.relation),
      })),
    )
    setFrames(Array.isArray(s.graph.frames) ? s.graph.frames : [])
    setRelatedOnly(false)
    setSearchOpen(false)
    setSearchQuery('')
  }, [])

  /** 轮询合并：同步文件/外部引用状态（新增上画布 / 丢失标记 / 大小时间），不动用户摆位 */
  const mergeFiles = useCallback(
    (list: FileInfo[], externalStatus: Record<string, ExternalStatus>, allowAutoAdd: boolean) => {
      setNodes((prev) => {
        const fileMap = new Map(list.map((f) => [f.name, f]))
        const next = prev.map((n) => {
          if (n.data.externalPath) {
            const st = externalStatus[n.data.externalPath]
            const lost = !st?.exists
            if (
              n.data.lost === lost &&
              n.data.size === st?.size &&
              n.data.mtime === st?.mtime &&
              n.data.kind === st?.kind
            ) {
              return n
            }
            return {
              ...n,
              data: { ...n.data, lost, size: st?.size, mtime: st?.mtime, kind: st?.kind },
            }
          }
          if (!n.data.fileName) return n
          const f = fileMap.get(n.data.fileName)
          const lost = !f
          if (
            n.data.lost === lost &&
            n.data.size === f?.size &&
            n.data.mtime === f?.mtime &&
            n.data.kind === f?.kind
          ) {
            return n
          }
          return { ...n, data: { ...n.data, lost, size: f?.size, mtime: f?.mtime, kind: f?.kind } }
        })
        if (!allowAutoAdd) {
          return next.some((n, i) => n !== prev[i]) ? next : prev
        }
        const onCanvas = new Set(next.map((n) => n.data.fileName).filter(Boolean))
        const added: FNode[] = []
        for (const f of list) {
          if (onCanvas.has(f.name) || removedRef.current.has(f.name)) continue
          const spot = freeSpot([...next, ...added])
          added.push({
            id: `file:${f.name}`,
            type: 'flowFile',
            position: spot,
            data: {
              fileName: f.name,
              placeholder: false,
              notes: [],
              size: f.size,
              mtime: f.mtime,
              kind: f.kind,
              auto: true,
            },
          })
        }
        return added.length || next.some((n, i) => n !== prev[i]) ? [...next, ...added] : prev
      })
    },
    [],
  )

  // 初始化 + 3 秒轮询
  useEffect(() => {
    let alive = true
    api
      .state()
      .then((s) => {
        if (!alive) return
        applyFullState(s)
        readyRef.current = true
      })
      .catch((e) => console.error('加载状态失败', e))
    const timer = window.setInterval(() => {
      if (!readyRef.current) return
      api
        .state()
        .then((s) => {
          if (!alive) return
          setDir(s.dir)
          setFiles(s.files)
          setRecentDirs(s.recentDirs)
          setCanvases(s.canvases)
          setActiveCanvas(s.activeCanvas)
          mergeFiles(s.files, s.externalStatus, s.activeCanvas.kind === 'dir')
        })
        .catch(() => {})
    }, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [applyFullState, mergeFiles])

  // ---------- 画布交互 ----------

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((prev) => applyNodeChanges(changes, prev)),
    [],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((prev) => applyEdgeChanges(changes, prev))
      if (changes.some((c) => c.type === 'remove')) scheduleSave()
    },
    [scheduleSave],
  )

  /** 键盘删除节点 = 仅从画布移除，绝不删文件 */
  const onNodesDelete = useCallback(
    (deleted: FNode[]) => {
      for (const n of deleted) {
        if (n.data.fileName) removedRef.current.add(n.data.fileName)
      }
      setSel((prev) =>
        prev?.kind === 'node' && deleted.some((d) => d.id === prev.id) ? null : prev,
      )
      scheduleSave()
    },
    [scheduleSave],
  )

  const onNodeDragStop = useCallback(
    (_: unknown, node: FNode, dragged: FNode[]) => {
      // 用户拖动 = 确认摆位：提交 auto 节点坐标（多选拖动时整批确认）
      const ids = new Set((dragged && dragged.length > 0 ? dragged : [node]).map((n) => n.id))
      setNodes((prev) =>
        prev.map((n) =>
          ids.has(n.id) && n.data.auto ? { ...n, data: { ...n.data, auto: false } } : n,
        ),
      )
      scheduleSave()
    },
    [scheduleSave],
  )

  const onConnect = useCallback((conn: Connection) => {
    if (!conn.source || !conn.target || conn.source === conn.target) return
    setPendingConn(conn)
  }, [])

  const confirmRelation = useCallback(
    (relation: string, note: string) => {
      if (!pendingConn?.source || !pendingConn.target) return
      const existing = edgesRef.current.find(
        (e) => e.source === pendingConn.source && e.target === pendingConn.target,
      )
      if (existing) {
        // 两节点间已有连线：选中它并在侧栏展示，避免"点了没反应"的困惑
        setSel({ kind: 'edge', id: existing.id })
        setPendingConn(null)
        return
      }
      setEdges((prev) => [
        ...prev,
        {
          id: `e:${crypto.randomUUID()}`,
          source: pendingConn.source!,
          target: pendingConn.target!,
          data: { relation, note, at: Date.now() },
          ...edgeVisual(relation),
        },
      ])
      scheduleSave()
      setPendingConn(null)
    },
    [pendingConn, scheduleSave],
  )

  // ---------- 侧栏操作 ----------

  const updateNode = useCallback(
    (id: string, patch: Partial<FileNodeData>) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch, auto: false } } : n,
        ),
      )
      scheduleSave()
    },
    [scheduleSave],
  )

  const addNote = useCallback(
    (id: string, text: string) => {
      const target = nodesRef.current.find((n) => n.id === id)
      if (!target) return
      updateNode(id, { notes: [...target.data.notes, { text, at: Date.now() }] })
    },
    [updateNode],
  )

  const deleteNote = useCallback(
    (id: string, index: number) => {
      const target = nodesRef.current.find((n) => n.id === id)
      if (!target) return
      updateNode(id, { notes: target.data.notes.filter((_, i) => i !== index) })
    },
    [updateNode],
  )

  /** 占位节点 → 文件节点；同时清掉同一文件的 auto 重复节点，并改写连线端点 */
  const convertNode = useCallback(
    (id: string, fileName: string) => {
      const newId = `file:${fileName}`
      const f = files.find((x) => x.name === fileName)
      setNodes((prev) =>
        prev
          .filter((n) => n.id === id || n.data.fileName !== fileName)
          .map((n) =>
            n.id === id
              ? {
                  ...n,
                  id: newId,
                  data: {
                    fileName,
                    label: undefined,
                    placeholder: false,
                    notes: n.data.notes,
                    lost: false,
                    size: f?.size,
                    mtime: f?.mtime,
                    auto: false,
                  },
                }
              : n,
          ),
      )
      setEdges((prev) =>
        prev.map((e) => ({
          ...e,
          source: e.source === id ? newId : e.source,
          target: e.target === id ? newId : e.target,
        })),
      )
      setSel({ kind: 'node', id: newId })
      scheduleSave()
    },
    [files, scheduleSave],
  )

  const handleMaterialize = useCallback(
    async (nodeId: string, fileName: string) => {
      await api.materialize(fileName)
      convertNode(nodeId, fileName)
      const s = await api.state()
      setFiles(s.files)
    },
    [convertNode],
  )

  const handleAssociate = useCallback(
    (nodeId: string, fileName: string) => convertNode(nodeId, fileName),
    [convertNode],
  )

  const updateEdgeNote = useCallback(
    (edgeId: string, note: string) => {
      setEdges((prev) =>
        prev.map((e) =>
          e.id === edgeId ? { ...e, data: { relation: e.data?.relation ?? '相关', at: e.data?.at ?? Date.now(), note } } : e,
        ),
      )
      scheduleSave()
    },
    [scheduleSave],
  )

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((prev) => prev.filter((e) => e.id !== edgeId))
      setSel(null)
      scheduleSave()
    },
    [scheduleSave],
  )

  const openNode = useCallback((n: FNode) => {
    const t = nodeTarget(n)
    if (!t) return
    api.open(t).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
  }, [])

  const revealNode = useCallback((n: FNode) => {
    const t = nodeTarget(n)
    if (!t) return
    api.reveal(t).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
  }, [])

  /** 仅从画布移除节点（连带相关连线），绝不动文件 */
  const removeNode = useCallback(
    (id: string) => {
      const target = nodesRef.current.find((n) => n.id === id)
      if (target?.data.fileName) removedRef.current.add(target.data.fileName)
      setNodes((prev) => prev.filter((n) => n.id !== id))
      setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id))
      setSel((prev) => (prev?.kind === 'node' && prev.id === id ? null : prev))
      scheduleSave()
    },
    [scheduleSave],
  )

  const trashNode = useCallback(
    async (n: FNode) => {
      if (!n.data.fileName) return
      await api.trash(n.data.fileName)
      toast.success(`已把「${n.data.fileName}」移到废纸篓`)
      removeNode(n.id)
    },
    [removeNode],
  )

  /** 外部引用断线修复：在最近文件夹里按文件名找回，更新 externalPath */
  const relocateNode = useCallback(
    async (n: FNode) => {
      if (!n.data.externalPath) return
      const res = await api.locate(baseName(n.data.externalPath))
      updateNode(n.id, {
        externalPath: res.path,
        label: baseName(res.path),
        lost: false,
      })
      toast.success(`已重新定位到 ${res.path}`)
    },
    [updateNode],
  )

  // ---------- 画布切换 ----------

  const switchAndApply = useCallback(
    async (p: Promise<StateResponse>) => {
      const s = await p
      setSel(null)
      applyFullState(s)
    },
    [applyFullState],
  )

  const handleSwitchDir = useCallback(
    (path: string) => switchAndApply(api.switchCanvas('dir', path)),
    [switchAndApply],
  )
  const handleSwitchCanvas = useCallback(
    (id: string) => switchAndApply(api.switchCanvas('canvas', id)),
    [switchAndApply],
  )
  const handleCreateCanvas = useCallback(
    (name: string) => switchAndApply(api.createCanvas(name)),
    [switchAndApply],
  )
  const handleDeleteCanvas = useCallback(
    (id: string) => switchAndApply(api.deleteCanvas(id)),
    [switchAndApply],
  )
  // 重命名不重建画布（避免 auto 节点重排），只更新列表
  const handleRenameCanvas = useCallback(async (id: string, name: string) => {
    const s = await api.renameCanvas(id, name)
    setCanvases(s.canvases)
  }, [])

  // ---------- 顶栏操作 ----------

  const changeDir = useCallback(async () => {
    const value = dirDraft.trim()
    if (!value) return
    setDirError('')
    try {
      const s = await api.setDir(value)
      applyFullState(s)
      setSel(null)
      setDirDialogOpen(false)
    } catch (e) {
      setDirError(e instanceof Error ? e.message : String(e))
    }
  }, [dirDraft, applyFullState])

  const addPlaceholder = useCallback(() => {
    const name = phName.trim()
    if (!name) return
    setNodes((prev) => [
      ...prev,
      {
        id: `ph:${crypto.randomUUID()}`,
        type: 'flowFile',
        position: freeSpot(prev),
        data: { fileName: null, label: name, placeholder: true, notes: [], auto: false },
      },
    ])
    scheduleSave()
    setPhName('')
    setPhDialogOpen(false)
  }, [phName, scheduleSave])

  /** 自由画布：引用任意绝对路径的文件 / 文件夹为外部节点 */
  const addExternal = useCallback(async () => {
    const value = extPath.trim()
    if (!value) return
    setExtError('')
    try {
      const info = await api.stat(value)
      const exists = nodesRef.current.some((n) => n.data.externalPath === info.path)
      if (exists) {
        setExtError('这个文件已经在画布上了')
        return
      }
      setNodes((prev) => [
        ...prev,
        {
          id: `ext:${crypto.randomUUID()}`,
          type: 'flowFile',
          position: freeSpot(prev),
          data: {
            fileName: null,
            label: info.name,
            externalPath: info.path,
            placeholder: false,
            notes: [],
            lost: false,
            size: info.size,
            mtime: info.mtime,
            kind: info.kind,
            auto: false,
          },
        },
      ])
      scheduleSave()
      setExtPath('')
      setExtDialogOpen(false)
    } catch (e) {
      setExtError(e instanceof Error ? e.message : String(e))
    }
  }, [extPath, scheduleSave])

  // ---------- 分组框 ----------

  const renameFrame = useCallback(
    (frameId: string, name: string) => {
      setFrames((prev) => prev.map((f) => (f.id === frameId ? { ...f, name } : f)))
      scheduleSave()
    },
    [scheduleSave],
  )

  /** 只删框不动节点 */
  const deleteFrame = useCallback(
    (frameId: string) => {
      setFrames((prev) => prev.filter((f) => f.id !== frameId))
      scheduleSave()
    },
    [scheduleSave],
  )

  /** 为当前选中的节点建组（自动贴合大小） */
  const groupFromSelection = useCallback(() => {
    const selected = nodesRef.current.filter((n) => n.selected)
    if (selected.length === 0) return
    const rect = frameFit(selected.map((n) => n.position))
    setFrames((prev) => [
      ...prev,
      { id: `fr:${crypto.randomUUID()}`, name: `分组 ${prev.length + 1}`, ...rect },
    ])
    scheduleSave()
  }, [scheduleSave])

  /** 在视口中心放一个空分组框 */
  const addEmptyFrame = useCallback(() => {
    const el = dropRef.current
    const vp = rf.getViewport()
    const cx = el ? (el.clientWidth / 2 - vp.x) / vp.zoom : 200
    const cy = el ? (el.clientHeight / 2 - vp.y) / vp.zoom : 200
    setFrames((prev) => [
      ...prev,
      {
        id: `fr:${crypto.randomUUID()}`,
        name: `分组 ${prev.length + 1}`,
        x: Math.round(cx - 160),
        y: Math.round(cy - 110),
        w: 320,
        h: 220,
      },
    ])
    scheduleSave()
  }, [rf, scheduleSave])

  /** 拖动分组框：中心点落在框内的节点一起移动（window 级监听，避免闭包拿旧 state） */
  const frameDragStart = useCallback(
    (frameId: string, e: React.PointerEvent) => {
      e.preventDefault()
      const fr = framesRef.current.find((f) => f.id === frameId)
      if (!fr) return
      const zoom = rf.getViewport().zoom
      const startX = e.clientX
      const startY = e.clientY
      const frameStart = { x: fr.x, y: fr.y }
      const memberMap = new Map(
        nodesRef.current
          .filter((n) => frameContains(fr, n.position.x + NODE_W / 2, n.position.y + NODE_H / 2))
          .map((n) => [n.id, { x: n.position.x, y: n.position.y }]),
      )
      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / zoom
        const dy = (ev.clientY - startY) / zoom
        setFrames((prev) =>
          prev.map((f) =>
            f.id === frameId
              ? { ...f, x: Math.round(frameStart.x + dx), y: Math.round(frameStart.y + dy) }
              : f,
          ),
        )
        if (memberMap.size > 0) {
          setNodes((prev) =>
            prev.map((n) => {
              const m = memberMap.get(n.id)
              if (!m) return n
              return {
                ...n,
                position: { x: Math.round(m.x + dx), y: Math.round(m.y + dy) },
                data: n.data.auto ? { ...n.data, auto: false } : n.data,
              }
            }),
          )
        }
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        scheduleSave()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
    },
    [rf, scheduleSave],
  )

  /** 拖拽右下角调整分组框大小 */
  const frameResizeStart = useCallback(
    (frameId: string, e: React.PointerEvent) => {
      e.preventDefault()
      const fr = framesRef.current.find((f) => f.id === frameId)
      if (!fr) return
      const zoom = rf.getViewport().zoom
      const startX = e.clientX
      const startY = e.clientY
      const sizeStart = { w: fr.w, h: fr.h }
      const onMove = (ev: PointerEvent) => {
        const dw = (ev.clientX - startX) / zoom
        const dh = (ev.clientY - startY) / zoom
        setFrames((prev) =>
          prev.map((f) =>
            f.id === frameId
              ? {
                  ...f,
                  w: Math.max(FRAME_MIN_W, Math.round(sizeStart.w + dw)),
                  h: Math.max(FRAME_MIN_H, Math.round(sizeStart.h + dh)),
                }
              : f,
          ),
        )
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        scheduleSave()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
    },
    [rf, scheduleSave],
  )

  // ---------- 批量操作 / 自动整理 ----------

  const alignSelected = useCallback(
    (mode: 'left' | 'top') => {
      setNodes((prev) => {
        const selected = prev.filter((n) => n.selected)
        if (selected.length < 2) return prev
        const v =
          mode === 'left'
            ? Math.min(...selected.map((n) => n.position.x))
            : Math.min(...selected.map((n) => n.position.y))
        const ids = new Set(selected.map((n) => n.id))
        return prev.map((n) =>
          ids.has(n.id)
            ? {
                ...n,
                position:
                  mode === 'left' ? { ...n.position, x: v } : { ...n.position, y: v },
              }
            : n,
        )
      })
      scheduleSave()
    },
    [scheduleSave],
  )

  /** 批量从画布移除（仅移画布不删文件） */
  const removeSelected = useCallback(() => {
    const selected = nodesRef.current.filter((n) => n.selected)
    if (selected.length === 0) return
    for (const n of selected) {
      if (n.data.fileName) removedRef.current.add(n.data.fileName)
    }
    const ids = new Set(selected.map((n) => n.id))
    setNodes((prev) => prev.filter((n) => !ids.has(n.id)))
    setEdges((prev) => prev.filter((e) => !ids.has(e.source) && !ids.has(e.target)))
    setSel(null)
    scheduleSave()
  }, [scheduleSave])

  /** 自动整理：拓扑分层布局 + 分组框跟随 + fitView */
  const autoLayout = useCallback(() => {
    const ns = nodesRef.current
    const pos = layeredPositions(
      ns,
      edgesRef.current.map((e) => ({ from: e.source, to: e.target })),
    )
    const laidOut = ns.map((n) => ({
      id: n.id,
      ...(pos.get(n.id) ?? { x: n.position.x, y: n.position.y }),
    }))
    setNodes((prev) =>
      prev.map((n) => {
        const p = pos.get(n.id)
        if (!p) return n
        return { ...n, position: p, data: n.data.auto ? { ...n.data, auto: false } : n.data }
      }),
    )
    setFrames((prev) => relayoutFrames(prev, laidOut))
    scheduleSave()
    window.setTimeout(() => {
      void rf.fitView({ padding: 0.2, duration: 300 })
    }, 80)
  }, [rf, scheduleSave])

  // ---------- 搜索定位（Cmd/Ctrl+F） ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      if (e.key === 'Escape' && searchOpenRef.current) {
        setSearchOpen(false)
        setSearchQuery('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (searchOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [searchOpen])

  /** 选中结果：平滑居中 + 选中（顺带清掉筛选，保证目标可见） */
  const jumpToHit = useCallback(
    (hit: SearchHit) => {
      setTypeFilter('all')
      setRelatedOnly(false)
      const zoom = Math.max(rf.getViewport().zoom, 1)
      if (hit.kind === 'node') {
        const n = nodesRef.current.find((x) => x.id === hit.id)
        if (!n) return
        setNodes((prev) => prev.map((x) => ({ ...x, selected: x.id === hit.id })))
        setEdges((prev) => prev.map((x) => ({ ...x, selected: false })))
        setSel({ kind: 'node', id: hit.id })
        rf.setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom, duration: 400 })
      } else {
        const e = edgesRef.current.find((x) => x.id === hit.id)
        if (!e) return
        setEdges((prev) => prev.map((x) => ({ ...x, selected: x.id === hit.id })))
        setNodes((prev) => prev.map((x) => ({ ...x, selected: false })))
        setSel({ kind: 'edge', id: hit.id })
        const s = nodesRef.current.find((x) => x.id === e.source)
        const t = nodesRef.current.find((x) => x.id === e.target)
        if (s && t) {
          rf.setCenter(
            (s.position.x + t.position.x) / 2 + NODE_W / 2,
            (s.position.y + t.position.y) / 2 + NODE_H / 2,
            { zoom, duration: 400 },
          )
        }
      }
    },
    [rf],
  )

  // ---------- 从 Finder 拖文件进画布 ----------

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const dropped = e.dataTransfer?.files
      if (!dropped || dropped.length === 0) return
      // 浏览器拿不到拖入文件的绝对路径，因此语义是"复制进受管文件夹"
      // screenToFlowPosition 直接接受 client 坐标，内部会扣除 pane 偏移并换算缩放
      const point = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const form = new FormData()
      for (const f of Array.from(dropped)) form.append('files', f)
      const isFreeCanvas = activeCanvasRef.current.kind === 'canvas'
      api
        .importFiles(form)
        .then(({ files: imported }) => {
          if (isFreeCanvas) {
            // 自由画布：不等轮询，直接以 externalPath 引用节点（指向受管文件夹里刚写入的副本）放到落点
            setNodes((prev) => {
              const existing = new Set(prev.map((n) => n.data.externalPath).filter(Boolean))
              const added: FNode[] = imported
                .filter((f) => !existing.has(f.path))
                .map((f, i) => ({
                  id: `ext:${crypto.randomUUID()}`,
                  type: 'flowFile' as const,
                  position: { x: point.x + i * 28, y: point.y + i * 28 },
                  data: {
                    fileName: null,
                    label: f.name,
                    externalPath: f.path,
                    placeholder: false,
                    notes: [],
                    lost: false,
                    size: f.size,
                    mtime: f.mtime,
                    kind: f.kind,
                    auto: false,
                  },
                }))
              return [...prev, ...added]
            })
            setFiles((prev) => {
              const names = new Set(imported.map((f) => f.name))
              return [...prev.filter((f) => !names.has(f.name)), ...imported]
            })
            scheduleSave()
            toast.success(`已复制到受管文件夹并引用 ${imported.length} 个文件`)
            return
          }
          for (const f of imported) removedRef.current.delete(f.name)
          setNodes((prev) => {
            const existing = new Set(prev.map((n) => n.data.fileName).filter(Boolean))
            const added: FNode[] = imported
              .filter((f) => !existing.has(f.name))
              .map((f, i) => ({
                id: `file:${f.name}`,
                type: 'flowFile' as const,
                position: { x: point.x + i * 28, y: point.y + i * 28 },
                data: {
                  fileName: f.name,
                  placeholder: false,
                  notes: [],
                  size: f.size,
                  mtime: f.mtime,
                  kind: f.kind,
                  auto: false,
                },
              }))
            return [...prev, ...added]
          })
          setFiles((prev) => {
            const names = new Set(imported.map((f) => f.name))
            return [...prev.filter((f) => !names.has(f.name)), ...imported]
          })
          scheduleSave()
          toast.success(`已导入 ${imported.length} 个文件`)
        })
        .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
    },
    [rf, scheduleSave],
  )

  // ---------- 空格键预览 ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      // 已有 Dialog 打开时不触发（Radix Dialog 内容带 role="dialog"）
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const current = selRef.current
      if (current?.kind !== 'node') return
      const n = nodesRef.current.find((x) => x.id === current.id)
      if (!n || n.data.placeholder || (!n.data.fileName && !n.data.externalPath)) return
      e.preventDefault()
      setQuickLookId(current.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---------- 筛选器派生：hidden 隐藏而非删数据 ----------

  const visibleNodes = useMemo(() => {
    if (typeFilter === 'all' && !relatedOnly) return nodes
    const typeOk = (n: FNode) => {
      if (typeFilter === 'all') return true
      if (typeFilter === 'placeholder') return n.data.placeholder
      return !n.data.placeholder && nodeCategory(n.data) === typeFilter
    }
    let keep: Set<string> | null = null
    if (relatedOnly && sel?.kind === 'node') {
      keep = new Set([sel.id])
      for (const e of edges) {
        if (e.source === sel.id) keep.add(e.target)
        if (e.target === sel.id) keep.add(e.source)
      }
    }
    return nodes.map((n) => ({
      ...n,
      hidden: !typeOk(n) || (keep !== null && !keep.has(n.id)),
    }))
  }, [nodes, edges, typeFilter, relatedOnly, sel])

  const visibleEdges = useMemo(() => {
    if (typeFilter === 'all' && !relatedOnly) return edges
    const hiddenIds = new Set(visibleNodes.filter((n) => n.hidden).map((n) => n.id))
    return edges.map((e) => ({
      ...e,
      hidden:
        hiddenIds.has(e.source) ||
        hiddenIds.has(e.target) ||
        (relatedOnly &&
          sel?.kind === 'node' &&
          e.source !== sel.id &&
          e.target !== sel.id),
    }))
  }, [edges, visibleNodes, typeFilter, relatedOnly, sel])

  const selectedNodes = useMemo(
    () => visibleNodes.filter((n) => n.selected && !n.hidden),
    [visibleNodes],
  )

  const searchHits = useMemo<SearchHit[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!searchOpen || !q) return []
    const hits: SearchHit[] = []
    for (const n of nodes) {
      const name = n.data.fileName ?? n.data.label ?? ''
      let snippet = findSnippet(name, q)
      if (snippet) {
        hits.push({ kind: 'node', id: n.id, title: name || '未命名', snippet })
        continue
      }
      for (const note of n.data.notes) {
        snippet = findSnippet(note.text, q)
        if (snippet) {
          hits.push({ kind: 'node', id: n.id, title: name || '未命名', snippet })
          break
        }
      }
    }
    for (const e of edges) {
      const snippet = findSnippet(e.data?.note ?? '', q)
      if (!snippet) continue
      const src = nodes.find((n) => n.id === e.source)
      const tgt = nodes.find((n) => n.id === e.target)
      const s = src?.data.fileName ?? src?.data.label ?? e.source
      const t = tgt?.data.fileName ?? tgt?.data.label ?? e.target
      hits.push({ kind: 'edge', id: e.id, title: `${s} → ${t}`, snippet })
    }
    return hits.slice(0, 20)
  }, [searchOpen, searchQuery, nodes, edges])

  const selNode = sel?.kind === 'node' ? nodes.find((n) => n.id === sel.id) ?? null : null
  const selEdge = sel?.kind === 'edge' ? edges.find((e) => e.id === sel.id) ?? null : null
  const quickLookNode = quickLookId ? nodes.find((n) => n.id === quickLookId) ?? null : null
  const activeCanvasName =
    activeCanvas.kind === 'canvas'
      ? canvases.find((c) => c.id === activeCanvas.id)?.name ?? '自由画布'
      : null

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
            <FolderOpen className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-slate-800">FlowFiles</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
            v0.3 原型
          </span>
        </div>
        <div className="mx-2 h-5 w-px bg-slate-200" />
        {activeCanvasName ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-slate-500">
            <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <span className="truncate font-medium text-slate-700">{activeCanvasName}</span>
            <span className="shrink-0 text-slate-400">（自由画布）</span>
          </div>
        ) : (
          <div className="min-w-0 flex-1 truncate text-xs text-slate-500" title={dir}>
            {dir || '…'}
          </div>
        )}
        <span className="text-xs text-slate-400">{files.length} 个文件</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDirDraft(dir)
            setDirError('')
            setDirDialogOpen(true)
          }}
        >
          <FolderSync className="mr-1 h-3.5 w-3.5" />
          更换文件夹
        </Button>
        {activeCanvas.kind === 'canvas' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setExtPath('')
              setExtError('')
              setExtDialogOpen(true)
            }}
          >
            <Link2 className="mr-1 h-3.5 w-3.5" />
            引用外部文件
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => {
            setPhName('')
            setPhDialogOpen(true)
          }}
        >
          <FilePlus2 className="mr-1 h-3.5 w-3.5" />
          新建占位节点
        </Button>
      </header>

      {/* 工具行：类型筛选 / 只看相关 / 自动整理 / 新建分组框 */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white/60 px-4 py-1.5">
        <div className="flex items-center gap-1">
          {TYPE_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setTypeFilter(c.key)}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs transition-colors',
                typeFilter === c.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="mx-1 h-4 w-px bg-slate-200" />
        {(selNode || relatedOnly) && (
          <button
            type="button"
            onClick={() => setRelatedOnly((v) => !v)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              relatedOnly
                ? 'bg-amber-500 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
            title="只保留选中节点和与它直接相连的节点"
          >
            只看相关
          </button>
        )}
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={autoLayout}>
          <Wand2 className="mr-1 h-3.5 w-3.5" />
          自动整理
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={addEmptyFrame}>
          <BoxSelect className="mr-1 h-3.5 w-3.5" />
          新建分组框
        </Button>
        <span className="ml-auto hidden text-[11px] text-slate-400 md:inline">
          Cmd+F 搜索 · 左键框选多选 · 中/右键平移
        </span>
        {activeCanvas.kind === 'canvas' && (
          <span className="text-[11px] text-emerald-600">
            拖入文件 = 复制到受管文件夹并引用
          </span>
        )}
      </div>

      {/* 画布栏 + 画布 + 侧栏 */}
      <div className="flex min-h-0 flex-1">
        <CanvasSidebar
          dir={dir}
          recentDirs={recentDirs}
          canvases={canvases}
          activeCanvas={activeCanvas}
          onSwitchDir={handleSwitchDir}
          onSwitchCanvas={handleSwitchCanvas}
          onCreateCanvas={handleCreateCanvas}
          onRenameCanvas={handleRenameCanvas}
          onDeleteCanvas={handleDeleteCanvas}
        />

        <div
          ref={dropRef}
          className="relative min-w-0 flex-1"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodesDelete={onNodesDelete}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSel({ kind: 'node', id: n.id })}
            onEdgeClick={(_, e) => setSel({ kind: 'edge', id: e.id })}
            onPaneClick={() => setSel(null)}
            connectionMode={ConnectionMode.Loose}
            deleteKeyCode={['Backspace', 'Delete']}
            selectionOnDrag
            panOnDrag={[1, 2]}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <FrameLayer
              frames={frames}
              onDragStart={frameDragStart}
              onResizeStart={frameResizeStart}
              onRename={renameFrame}
              onDelete={deleteFrame}
            />
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#cbd5e1" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!h-24 !w-36" />
          </ReactFlow>

          {/* 批量工具栏（多选 ≥2 时浮出） */}
          {selectedNodes.length >= 2 && !searchOpen && (
            <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 shadow-lg">
              <span className="mr-1 text-xs text-slate-500">已选 {selectedNodes.length} 项</span>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={groupFromSelection}>
                <BoxSelect className="mr-1 h-3.5 w-3.5" />
                建组
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => alignSelected('left')}
              >
                <AlignStartVertical className="mr-1 h-3.5 w-3.5" />
                左对齐
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => alignSelected('top')}
              >
                <AlignStartHorizontal className="mr-1 h-3.5 w-3.5" />
                顶对齐
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                onClick={removeSelected}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                从画布移除
              </Button>
            </div>
          )}

          {/* 搜索浮层（Cmd/Ctrl+F） */}
          {searchOpen && (
            <div className="absolute left-1/2 top-3 z-30 w-[420px] -translate-x-1/2 rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchHits.length > 0) {
                      jumpToHit(searchHits[0])
                      setSearchOpen(false)
                      setSearchQuery('')
                    }
                  }}
                  placeholder="搜索文件名、节点备注、连线备注…"
                  className="h-6 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
                <kbd className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
                  Esc
                </kbd>
              </div>
              {searchQuery.trim() && (
                <ul className="max-h-[300px] overflow-y-auto p-1.5">
                  {searchHits.length === 0 && (
                    <li className="px-3 py-2 text-xs text-slate-400">没有匹配结果</li>
                  )}
                  {searchHits.map((h) => {
                    const hitNode = h.kind === 'node' ? nodes.find((n) => n.id === h.id) : undefined
                    const HitIcon =
                      h.kind === 'edge'
                        ? Link2
                        : hitNode?.data.placeholder
                          ? FilePlus2
                          : hitNode?.data.kind === 'dir'
                            ? Folder
                            : FileText
                    return (
                      <li key={`${h.kind}:${h.id}`}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100"
                          onClick={() => {
                            jumpToHit(h)
                            setSearchOpen(false)
                            setSearchQuery('')
                          }}
                        >
                          <HitIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-slate-800">{h.title}</div>
                            <div className="truncate text-[11px] text-slate-400">{h.snippet}</div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {(selNode || selEdge) && (
          <DetailSidebar
            node={selNode}
            edge={selEdge}
            nodes={nodes}
            files={files}
            onClose={() => setSel(null)}
            onOpenFile={openNode}
            onRevealFile={revealNode}
            onAddNote={addNote}
            onDeleteNote={deleteNote}
            onMaterialize={handleMaterialize}
            onAssociate={handleAssociate}
            onUpdateEdgeNote={updateEdgeNote}
            onDeleteEdge={deleteEdge}
            onRemoveNode={removeNode}
            onTrashNode={trashNode}
            onRelocate={relocateNode}
          />
        )}
      </div>

      {/* 拉线建关系 */}
      <RelationDialog
        open={pendingConn !== null}
        onOpenChange={(o) => {
          if (!o) setPendingConn(null)
        }}
        onConfirm={confirmRelation}
      />

      {/* 空格键快速预览 */}
      <QuickLookDialog
        node={quickLookNode}
        open={quickLookNode !== null}
        onOpenChange={(o) => {
          if (!o) setQuickLookId(null)
        }}
        onOpenFile={openNode}
      />

      {/* 更换文件夹 */}
      <Dialog open={dirDialogOpen} onOpenChange={setDirDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>更换受管文件夹</DialogTitle>
            <DialogDescription>输入一个本机文件夹的绝对路径，画布将切换为该文件夹。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label>文件夹路径</Label>
            <Input
              value={dirDraft}
              onChange={(e) => setDirDraft(e.target.value)}
              placeholder="/Users/你/Documents/某个文件夹"
              onKeyDown={(e) => e.key === 'Enter' && changeDir()}
            />
            {dirError && <p className="text-xs text-red-500">{dirError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDirDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={changeDir} disabled={!dirDraft.trim()}>
              切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建占位节点 */}
      <Dialog open={phDialogOpen} onOpenChange={setPhDialogOpen}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>新建占位节点</DialogTitle>
            <DialogDescription>
              先占一个坑：节点还没有对应文件，之后可以在侧栏里创建或关联真实文件。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label>名称</Label>
            <Input
              value={phName}
              onChange={(e) => setPhName(e.target.value)}
              placeholder="例如 launch-checklist.md"
              onKeyDown={(e) => e.key === 'Enter' && addPlaceholder()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={addPlaceholder} disabled={!phName.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 引用外部文件（自由画布） */}
      <Dialog open={extDialogOpen} onOpenChange={setExtDialogOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>引用外部文件</DialogTitle>
            <DialogDescription>
              输入任意文件或文件夹的绝对路径，它会以引用节点出现在自由画布上（原文件不会被移动）。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label>文件路径</Label>
            <Input
              value={extPath}
              onChange={(e) => setExtPath(e.target.value)}
              placeholder="/Users/你/Documents/某个文件.md"
              onKeyDown={(e) => e.key === 'Enter' && addExternal()}
            />
            {extError && <p className="text-xs text-red-500">{extError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={addExternal} disabled={!extPath.trim()}>
              引用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster richColors position="bottom-right" />
    </div>
  )
}

export default function Home() {
  return (
    <ReactFlowProvider>
      <HomeInner />
    </ReactFlowProvider>
  )
}
