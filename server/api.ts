import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const execFileAsync = promisify(execFile)

export interface NoteItem {
  text: string
  at: number
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
  frames?: GraphFrame[]
}

export interface FileInfo {
  name: string
  size: number
  mtime: number
  kind: 'file' | 'dir'
}

/** /api/import 的返回项：path 是写入受管文件夹后的绝对路径 */
export interface ImportResultItem extends FileInfo {
  path: string
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

export interface Config {
  dir: string
  recentDirs: string[]
  activeCanvas: ActiveCanvas
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

const RELATIONS = new Set(['迭代', '引用', '相关'])

/** graph.json 的 key 规则：文件夹画布 dir:<绝对路径>，自由画布 canvas:<id>；无前缀的旧 key 一律视为文件夹路径 */
const DIR_PREFIX = 'dir:'
const CANVAS_PREFIX = 'canvas:'

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
}
/** /api/thumb 支持图片 + pdf（pdf 供前端 <embed> 原生渲染） */
const THUMB_MIME: Record<string, string> = { ...IMAGE_MIME, pdf: 'application/pdf' }
const TEXT_EXTS = new Set([
  'md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'log',
  'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'htm', 'xml',
  'yml', 'yaml', 'toml', 'ini', 'sh', 'py', 'conf', 'cfg',
])
const PREVIEW_CHARS = 800
const MAX_JSON_BODY = 5_000_000
const MAX_UPLOAD_BODY = 300_000_000

// 1x1 红色 PNG，用作演示数据里的 cover-mockup.png
const DEMO_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const DEMO_TEXT_FILES: Record<string, string> = {
  'idea-note.md':
    '# 灵感速记\n\n- 画布即文件夹：文件自动铺成节点\n- 节点之间可以拉线表示迭代 / 引用\n- 占位节点先占坑，事后补文件\n',
  'plan-v1.md':
    '# 产品计划 v1\n\n1. 整理 idea-note 里的零散想法\n2. 形成结构化初稿\n3. 待补充：数据章节\n',
  'plan-v2.md':
    '# 产品计划 v2\n\n1. 保留 v1 主体结构\n2. 新增第三章：调研数据分析（引用 survey-data.csv）\n3. 新增两张图表 + 封面配图（cover-mockup.png）\n',
  'survey-data.csv':
    'date,respondents,positive,neutral,negative\n2024-01,120,78,30,12\n2024-02,135,91,32,12\n2024-03,150,104,33,13\n',
  'README.md':
    '# demo-folder\n\n这是 FlowFiles 的演示受管文件夹。\n\n- 文件会实时同步到画布\n- 在这里新增文件，3 秒内自动出现在画布上\n- 删除文件后对应节点会标记「已丢失」\n',
}

function emptyGraph(): Graph {
  return { nodes: [], edges: [] }
}

export function flowFilesApi(rootDir: string): Plugin {
  const dataDir = path.join(rootDir, 'server-data')
  const graphPath = path.join(dataDir, 'graph.json')
  const configPath = path.join(dataDir, 'config.json')
  const canvasesPath = path.join(dataDir, 'canvases.json')
  const demoDir = path.join(rootDir, 'demo-folder')

  // ---------- 持久化 ----------

  function writeJson(file: string, data: unknown) {
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, file)
  }

  /** 读取配置并做旧格式迁移：旧 config 只有 dir 时自动补齐 recentDirs / activeCanvas */
  function readConfig(): Config {
    let raw: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>
      }
    } catch {
      /* fall through */
    }
    const dir = typeof raw.dir === 'string' && raw.dir ? raw.dir : demoDir
    let recentDirs = Array.isArray(raw.recentDirs)
      ? raw.recentDirs.filter((d): d is string => typeof d === 'string' && !!d)
      : []
    recentDirs = [...new Set(recentDirs)]
    if (!recentDirs.includes(dir)) recentDirs.unshift(dir)
    recentDirs = recentDirs.slice(0, 10)
    const ac = raw.activeCanvas as Partial<ActiveCanvas> | undefined
    const activeCanvas: ActiveCanvas =
      ac && (ac.kind === 'dir' || ac.kind === 'canvas') && typeof ac.id === 'string' && ac.id
        ? { kind: ac.kind, id: ac.id }
        : { kind: 'dir', id: dir }
    const cfg: Config = { dir, recentDirs, activeCanvas }
    // 迁移或规范化后立即落盘，保持文件为最新格式
    if (
      !Array.isArray(raw.recentDirs) ||
      !raw.activeCanvas ||
      JSON.stringify(raw.recentDirs) !== JSON.stringify(cfg.recentDirs)
    ) {
      writeJson(configPath, cfg)
    }
    return cfg
  }

  function writeConfig(cfg: Config) {
    writeJson(configPath, cfg)
  }

  /** 把文件夹推到 recentDirs 最前（去重、上限 10） */
  function pushRecent(cfg: Config, dir: string) {
    cfg.recentDirs = [dir, ...cfg.recentDirs.filter((d) => d !== dir)].slice(0, 10)
  }

  function readCanvases(): CanvasMeta[] {
    try {
      const raw = JSON.parse(fs.readFileSync(canvasesPath, 'utf8')) as unknown
      if (raw && typeof raw === 'object' && Array.isArray((raw as { canvases?: unknown }).canvases)) {
        return (raw as { canvases: CanvasMeta[] }).canvases.filter(
          (c) => c && typeof c.id === 'string' && typeof c.name === 'string',
        )
      }
    } catch {
      /* fall through */
    }
    return []
  }

  function writeCanvases(canvases: CanvasMeta[]) {
    writeJson(canvasesPath, { canvases })
  }

  function readGraphFile(): Record<string, Graph> {
    try {
      const raw = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as unknown
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, Graph>
      }
    } catch {
      /* fall through */
    }
    return {}
  }

  /** 读取文件夹画布：优先 dir: 前缀 key，向后兼容无前缀的旧 key */
  function getGraphForDir(graphs: Record<string, Graph>, dir: string): Graph {
    return graphs[DIR_PREFIX + dir] ?? graphs[dir] ?? emptyGraph()
  }

  /** 写入文件夹画布：统一用 dir: 前缀 key，并清掉旧的无前缀 key */
  function setGraphForDir(graphs: Record<string, Graph>, dir: string, graph: Graph) {
    delete graphs[dir]
    graphs[DIR_PREFIX + dir] = graph
  }

  /** 当前激活画布对应的 graph key；自由画布被删除等异常情况回退到当前 dir 画布 */
  function activeGraphKey(cfg: Config, canvases: CanvasMeta[]): string {
    if (cfg.activeCanvas.kind === 'canvas' && canvases.some((c) => c.id === cfg.activeCanvas.id)) {
      return CANVAS_PREFIX + cfg.activeCanvas.id
    }
    return DIR_PREFIX + cfg.dir
  }

  function normalizedActiveCanvas(cfg: Config, canvases: CanvasMeta[]): ActiveCanvas {
    if (cfg.activeCanvas.kind === 'canvas' && canvases.some((c) => c.id === cfg.activeCanvas.id)) {
      return cfg.activeCanvas
    }
    return { kind: 'dir', id: cfg.dir }
  }

  function getActiveGraph(cfg: Config, canvases: CanvasMeta[]): Graph {
    const graphs = readGraphFile()
    const key = activeGraphKey(cfg, canvases)
    if (key.startsWith(CANVAS_PREFIX)) return graphs[key] ?? emptyGraph()
    return getGraphForDir(graphs, cfg.dir)
  }

  // ---------- 播种 ----------

  function seedDemoFolder() {
    fs.mkdirSync(demoDir, { recursive: true })
    for (const [name, content] of Object.entries(DEMO_TEXT_FILES)) {
      fs.writeFileSync(path.join(demoDir, name), content)
    }
    fs.writeFileSync(path.join(demoDir, 'cover-mockup.png'), Buffer.from(DEMO_PNG_BASE64, 'base64'))
  }

  function seedGraph(): Graph {
    const now = Date.now()
    const fileNode = (fileName: string, x: number, y: number): GraphNode => ({
      id: `file:${fileName}`,
      fileName,
      x,
      y,
      placeholder: false,
      notes: [],
    })
    return {
      nodes: [
        fileNode('idea-note.md', 60, 60),
        fileNode('plan-v1.md', 380, 60),
        fileNode('plan-v2.md', 700, 60),
        fileNode('survey-data.csv', 380, 330),
        fileNode('cover-mockup.png', 700, 330),
        {
          id: 'ph:launch-checklist',
          fileName: null,
          label: 'launch-checklist',
          x: 1020,
          y: 190,
          placeholder: true,
          notes: [],
        },
      ],
      edges: [
        { id: `e:${crypto.randomUUID()}`, from: 'file:idea-note.md', to: 'file:plan-v1.md', relation: '迭代', note: '把零散想法整理成结构化初稿', at: now },
        { id: `e:${crypto.randomUUID()}`, from: 'file:plan-v1.md', to: 'file:plan-v2.md', relation: '迭代', note: '补充了数据章节和两张图表', at: now },
        { id: `e:${crypto.randomUUID()}`, from: 'file:survey-data.csv', to: 'file:plan-v2.md', relation: '引用', note: '第三章数据来源', at: now },
        { id: `e:${crypto.randomUUID()}`, from: 'file:cover-mockup.png', to: 'file:plan-v2.md', relation: '引用', note: '封面配图初稿', at: now },
      ],
    }
  }

  function ensureSetup() {
    fs.mkdirSync(dataDir, { recursive: true })
    if (!fs.existsSync(demoDir)) seedDemoFolder()
    if (!fs.existsSync(configPath)) {
      writeJson(configPath, {
        dir: demoDir,
        recentDirs: [demoDir],
        activeCanvas: { kind: 'dir', id: demoDir },
      } satisfies Config)
    }
    if (!fs.existsSync(canvasesPath)) writeCanvases([])
    const graphs = readGraphFile()
    if (!getGraphForDir(graphs, demoDir).nodes.length && !graphs[DIR_PREFIX + demoDir] && !graphs[demoDir]) {
      setGraphForDir(graphs, demoDir, seedGraph())
      writeJson(graphPath, graphs)
    }
  }

  // ---------- 业务 ----------

  function listFiles(dir: string): FileInfo[] {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const files: FileInfo[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const isDir = entry.isDirectory()
      if (!isDir && !entry.isFile()) continue
      try {
        const st = fs.statSync(path.join(dir, entry.name))
        files.push({
          name: entry.name,
          size: isDir ? 0 : st.size,
          mtime: Math.round(st.mtimeMs),
          kind: isDir ? 'dir' : 'file',
        })
      } catch {
        /* 条目可能在扫描期间被删除，跳过 */
      }
    }
    // 文件夹排在前面，同类内按名称排序
    files.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'zh-CN'),
    )
    return files
  }

  function buildState(): StateResponse {
    const cfg = readConfig()
    const canvases = readCanvases()
    const graph = getActiveGraph(cfg, canvases)
    const externalStatus: Record<string, ExternalStatus> = {}
    for (const n of graph.nodes) {
      if (!n.externalPath || externalStatus[n.externalPath]) continue
      try {
        const st = fs.statSync(n.externalPath)
        externalStatus[n.externalPath] = {
          exists: true,
          size: st.isDirectory() ? 0 : st.size,
          mtime: Math.round(st.mtimeMs),
          kind: st.isDirectory() ? 'dir' : 'file',
        }
      } catch {
        externalStatus[n.externalPath] = { exists: false }
      }
    }
    return {
      dir: cfg.dir,
      recentDirs: cfg.recentDirs,
      canvases,
      activeCanvas: normalizedActiveCanvas(cfg, canvases),
      files: listFiles(cfg.dir),
      graph,
      externalStatus,
    }
  }

  /** 将 fileName 解析为受管文件夹内的绝对路径；越界则返回 null */
  function resolveInside(fileName: unknown): string | null {
    if (typeof fileName !== 'string' || fileName.length === 0) return null
    const dir = readConfig().dir
    const p = path.resolve(dir, fileName)
    return p.startsWith(dir + path.sep) ? p : null
  }

  /** 绝对路径是否登记为当前激活画布上某个节点的 externalPath（用于 /api/thumb /api/preview 的 ?path= 校验） */
  function isRegisteredExternal(absPath: string): boolean {
    const cfg = readConfig()
    const graph = getActiveGraph(cfg, readCanvases())
    const target = path.resolve(absPath)
    return graph.nodes.some((n) => !!n.externalPath && path.resolve(n.externalPath) === target)
  }

  function sanitizeGraph(input: unknown): Graph {
    const g = (input ?? {}) as { nodes?: unknown; edges?: unknown; frames?: unknown }
    const rawNodes = Array.isArray(g.nodes) ? g.nodes : []
    const rawEdges = Array.isArray(g.edges) ? g.edges : []
    const rawFrames = Array.isArray(g.frames) ? g.frames : []

    const nodes: GraphNode[] = []
    for (const item of rawNodes) {
      const n = item as Partial<GraphNode>
      if (!n || typeof n.id !== 'string' || !n.id) continue
      const notes: NoteItem[] = Array.isArray(n.notes)
        ? n.notes
            .filter((t): t is NoteItem => !!t && typeof (t as NoteItem).text === 'string')
            .map((t) => ({ text: String(t.text), at: Number(t.at) || Date.now() }))
        : []
      nodes.push({
        id: n.id,
        fileName: typeof n.fileName === 'string' && n.fileName ? n.fileName : null,
        ...(typeof n.label === 'string' && n.label ? { label: n.label } : {}),
        ...(typeof n.externalPath === 'string' && n.externalPath
          ? { externalPath: n.externalPath }
          : {}),
        x: Number.isFinite(n.x) ? Number(n.x) : 0,
        y: Number.isFinite(n.y) ? Number(n.y) : 0,
        placeholder: !!n.placeholder,
        notes,
      })
    }

    const edges: GraphEdge[] = []
    for (const item of rawEdges) {
      const e = item as Partial<GraphEdge>
      if (!e || typeof e.id !== 'string' || !e.id) continue
      if (typeof e.from !== 'string' || typeof e.to !== 'string') continue
      edges.push({
        id: e.id,
        from: e.from,
        to: e.to,
        relation: RELATIONS.has(String(e.relation)) ? String(e.relation) : '相关',
        note: typeof e.note === 'string' ? e.note : '',
        at: Number(e.at) || Date.now(),
      })
    }

    const frames: GraphFrame[] = []
    for (const item of rawFrames) {
      const f = item as Partial<GraphFrame>
      if (!f || typeof f.id !== 'string' || !f.id) continue
      const w = Number(f.w)
      const h = Number(f.h)
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue
      frames.push({
        id: f.id,
        name: typeof f.name === 'string' && f.name ? f.name : '未命名分组',
        x: Number.isFinite(f.x) ? Number(f.x) : 0,
        y: Number.isFinite(f.y) ? Number(f.y) : 0,
        w,
        h,
      })
    }
    return { nodes, edges, frames }
  }

  /** 重名时自动加 -1 后缀：foo.txt → foo-1.txt */
  function uniqueName(dir: string, name: string): string {
    if (!fs.existsSync(path.join(dir, name))) return name
    const ext = path.extname(name)
    const stem = name.slice(0, name.length - ext.length)
    for (let i = 1; ; i++) {
      const cand = `${stem}-${i}${ext}`
      if (!fs.existsSync(path.join(dir, cand))) return cand
    }
  }

  // ---------- HTTP 工具 ----------

  function sendJson(res: ServerResponse, status: number, obj: unknown) {
    const body = JSON.stringify(obj)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8')
        if (raw.length > MAX_JSON_BODY) reject(new Error('请求体过大'))
      })
      req.on('end', () => {
        if (!raw) return resolve({})
        try {
          resolve(JSON.parse(raw) as Record<string, unknown>)
        } catch {
          reject(new Error('请求体不是合法 JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > limit) {
          reject(new Error('上传内容过大'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }

  /** 极简 multipart/form-data 解析，提取其中的文件部分 */
  function parseMultipart(buf: Buffer, boundary: string): { filename: string; data: Buffer }[] {
    const parts: { filename: string; data: Buffer }[] = []
    const dash = Buffer.from(`--${boundary}`)
    let pos = buf.indexOf(dash)
    while (pos !== -1) {
      const next = buf.indexOf(dash, pos + dash.length)
      const segEnd = next === -1 ? buf.length : next
      let seg = buf.subarray(pos + dash.length, segEnd)
      if (seg.length >= 2 && seg[0] === 0x2d && seg[1] === 0x2d) break // 结束标记 --boundary--
      if (seg.length >= 2 && seg[0] === 0x0d && seg[1] === 0x0a) seg = seg.subarray(2)
      if (seg.length >= 2 && seg[seg.length - 2] === 0x0d && seg[seg.length - 1] === 0x0a) {
        seg = seg.subarray(0, seg.length - 2)
      }
      const headerEnd = seg.indexOf('\r\n\r\n')
      if (headerEnd !== -1) {
        const header = seg.subarray(0, headerEnd).toString('utf8')
        const data = seg.subarray(headerEnd + 4)
        const star = /filename\*=(?:UTF-8|utf-8)''([^;\r\n]+)/.exec(header)
        const plain = /filename="([^"]*)"/.exec(header)
        let filename: string | null = null
        try {
          filename = star ? decodeURIComponent(star[1]) : plain ? plain[1] : null
        } catch {
          filename = plain ? plain[1] : null
        }
        if (filename) parts.push({ filename, data })
      }
      pos = next
    }
    return parts
  }

  /** 解析 /api/thumb /api/preview 的目标：?name=（受管文件夹内）或 ?path=（已登记的外部引用） */
  function resolveMediaTarget(url: URL): { p: string } | { status: number; error: string } {
    const name = url.searchParams.get('name')
    const extPath = url.searchParams.get('path')
    if (name) {
      const p = resolveInside(name)
      if (!p) return { status: 400, error: '非法文件名：路径越出受管文件夹' }
      return { p }
    }
    if (extPath) {
      if (!path.isAbsolute(extPath)) return { status: 400, error: 'path 必须是绝对路径' }
      if (!isRegisteredExternal(extPath)) {
        return { status: 403, error: '该路径未登记为当前画布的外部引用节点' }
      }
      return { p: path.resolve(extPath) }
    }
    return { status: 400, error: '缺少 name 或 path 参数' }
  }

  function expandDirInput(input: string): string {
    const expanded = input.startsWith('~') ? path.join(os.homedir(), input.slice(1)) : input
    return path.resolve(expanded)
  }

  function statDir(dir: string): fs.Stats | null {
    try {
      const st = fs.statSync(dir)
      return st.isDirectory() ? st : null
    } catch {
      return null
    }
  }

  // ---------- 路由 ----------

  async function handle(req: IncomingMessage, res: ServerResponse) {
    ensureSetup()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'GET' && route === '/state') {
      return sendJson(res, 200, buildState())
    }

    if (method === 'GET' && route === '/thumb') {
      const target = resolveMediaTarget(url)
      if ('error' in target) return sendJson(res, target.status, { error: target.error })
      const ext = path.extname(target.p).slice(1).toLowerCase()
      const mime = THUMB_MIME[ext]
      if (!mime) return sendJson(res, 415, { error: `不支持预览的文件类型：${ext || '(无扩展名)'}` })
      let st: fs.Stats
      try {
        st = fs.statSync(target.p)
        if (!st.isFile()) throw new Error('not a file')
      } catch {
        return sendJson(res, 404, { error: '文件不存在' })
      }
      res.writeHead(200, {
        'content-type': mime,
        'content-length': st.size,
        'cache-control': 'no-store',
      })
      fs.createReadStream(target.p).pipe(res)
      return
    }

    if (method === 'GET' && route === '/preview') {
      const target = resolveMediaTarget(url)
      if ('error' in target) return sendJson(res, target.status, { error: target.error })
      const ext = path.extname(target.p).slice(1).toLowerCase()
      if (!TEXT_EXTS.has(ext)) {
        return sendJson(res, 415, { error: `不支持文本预览的文件类型：${ext || '(无扩展名)'}` })
      }
      let fd: number
      try {
        fd = fs.openSync(target.p, 'r')
      } catch {
        return sendJson(res, 404, { error: '文件不存在' })
      }
      try {
        const buf = Buffer.alloc(64 * 1024)
        const n = fs.readSync(fd, buf, 0, buf.length, 0)
        const full = buf.subarray(0, n).toString('utf8')
        const truncated = full.length > PREVIEW_CHARS
        return sendJson(res, 200, {
          text: truncated ? full.slice(0, PREVIEW_CHARS) : full,
          truncated,
        })
      } finally {
        fs.closeSync(fd)
      }
    }

    if (method === 'POST' && route === '/dir') {
      const body = await readJsonBody(req)
      const input = typeof body.dir === 'string' ? body.dir.trim() : ''
      if (!input) return sendJson(res, 400, { error: '缺少 dir 参数' })
      const dir = expandDirInput(input)
      if (!statDir(dir)) return sendJson(res, 400, { error: `文件夹不存在或不是文件夹：${dir}` })
      const cfg = readConfig()
      cfg.dir = dir
      pushRecent(cfg, dir)
      cfg.activeCanvas = { kind: 'dir', id: dir }
      writeConfig(cfg)
      return sendJson(res, 200, buildState())
    }

    if (method === 'POST' && route === '/graph') {
      const body = await readJsonBody(req)
      const graph = sanitizeGraph(body)
      const cfg = readConfig()
      const canvases = readCanvases()
      const graphs = readGraphFile()
      const key = activeGraphKey(cfg, canvases)
      if (key.startsWith(CANVAS_PREFIX)) {
        graphs[key] = graph
      } else {
        setGraphForDir(graphs, cfg.dir, graph)
      }
      writeJson(graphPath, graphs)
      return sendJson(res, 200, { ok: true })
    }

    if (method === 'POST' && route === '/canvas') {
      const body = await readJsonBody(req)
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return sendJson(res, 400, { error: '画布名称不能为空' })
      const canvases = readCanvases()
      const meta: CanvasMeta = { id: crypto.randomUUID(), name, createdAt: Date.now() }
      canvases.push(meta)
      writeCanvases(canvases)
      const cfg = readConfig()
      cfg.activeCanvas = { kind: 'canvas', id: meta.id }
      writeConfig(cfg)
      return sendJson(res, 200, buildState())
    }

    if (method === 'POST' && route === '/canvas/switch') {
      const body = await readJsonBody(req)
      const kind = body.kind
      const id = typeof body.id === 'string' ? body.id : ''
      const cfg = readConfig()
      if (kind === 'dir') {
        if (!id) return sendJson(res, 400, { error: '缺少文件夹路径' })
        const dir = expandDirInput(id)
        if (!statDir(dir)) return sendJson(res, 400, { error: `文件夹不存在或不是文件夹：${dir}` })
        cfg.dir = dir
        pushRecent(cfg, dir)
        cfg.activeCanvas = { kind: 'dir', id: dir }
      } else if (kind === 'canvas') {
        const canvases = readCanvases()
        if (!canvases.some((c) => c.id === id)) {
          return sendJson(res, 404, { error: '画布不存在或已被删除' })
        }
        cfg.activeCanvas = { kind: 'canvas', id }
      } else {
        return sendJson(res, 400, { error: 'kind 必须是 dir 或 canvas' })
      }
      writeConfig(cfg)
      return sendJson(res, 200, buildState())
    }

    if (method === 'POST' && route === '/canvas/rename') {
      const body = await readJsonBody(req)
      const id = typeof body.id === 'string' ? body.id : ''
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return sendJson(res, 400, { error: '画布名称不能为空' })
      const canvases = readCanvases()
      const target = canvases.find((c) => c.id === id)
      if (!target) return sendJson(res, 404, { error: '画布不存在或已被删除' })
      target.name = name
      writeCanvases(canvases)
      return sendJson(res, 200, buildState())
    }

    if (method === 'POST' && route === '/canvas/delete') {
      const body = await readJsonBody(req)
      const id = typeof body.id === 'string' ? body.id : ''
      const canvases = readCanvases()
      const next = canvases.filter((c) => c.id !== id)
      if (next.length === canvases.length) {
        return sendJson(res, 404, { error: '画布不存在或已被删除' })
      }
      writeCanvases(next)
      const graphs = readGraphFile()
      delete graphs[CANVAS_PREFIX + id]
      writeJson(graphPath, graphs)
      const cfg = readConfig()
      if (cfg.activeCanvas.kind === 'canvas' && cfg.activeCanvas.id === id) {
        cfg.activeCanvas = { kind: 'dir', id: cfg.dir }
        writeConfig(cfg)
      }
      return sendJson(res, 200, buildState())
    }

    if ((method === 'POST' && route === '/open') || (method === 'POST' && route === '/reveal')) {
      const body = await readJsonBody(req)
      let p: string | null = null
      if (typeof body.path === 'string' && body.path) {
        // 外部引用节点：绝对路径，open/reveal 是只读动作，校验存在即可
        p = path.resolve(body.path)
      } else {
        p = resolveInside(body.fileName)
        if (!p) return sendJson(res, 400, { error: '非法文件名：路径越出受管文件夹' })
      }
      if (!fs.existsSync(p)) return sendJson(res, 404, { error: '文件不存在' })
      const args = route === '/reveal' ? ['-R', p] : [p]
      try {
        await execFileAsync('open', args)
        return sendJson(res, 200, { ok: true })
      } catch (err) {
        return sendJson(res, 500, { error: `open 命令失败：${err instanceof Error ? err.message : String(err)}` })
      }
    }

    if (method === 'POST' && route === '/locate') {
      const body = await readJsonBody(req)
      const name = typeof body.fileName === 'string' ? body.fileName.trim() : ''
      if (!name || name.includes('/') || name.includes('\\')) {
        return sendJson(res, 400, { error: 'locate 只接受纯文件名（不含路径分隔符）' })
      }
      const cfg = readConfig()
      const candidates = [...new Set([cfg.dir, ...cfg.recentDirs])]
      for (const d of candidates) {
        const p = path.join(d, name)
        if (fs.existsSync(p)) return sendJson(res, 200, { path: p })
      }
      return sendJson(res, 404, { error: `在最近文件夹中没有找到：${name}` })
    }

    if (method === 'POST' && route === '/stat') {
      const body = await readJsonBody(req)
      const input = typeof body.path === 'string' ? body.path.trim() : ''
      if (!input) return sendJson(res, 400, { error: '缺少 path 参数' })
      const expanded = input.startsWith('~') ? path.join(os.homedir(), input.slice(1)) : input
      const p = path.resolve(expanded)
      let st: fs.Stats
      try {
        st = fs.statSync(p)
      } catch {
        return sendJson(res, 404, { error: `路径不存在：${p}` })
      }
      const isDir = st.isDirectory()
      if (!isDir && !st.isFile()) return sendJson(res, 400, { error: '路径不是文件或文件夹' })
      return sendJson(res, 200, {
        path: p,
        name: path.basename(p),
        size: isDir ? 0 : st.size,
        mtime: Math.round(st.mtimeMs),
        kind: isDir ? 'dir' : 'file',
      })
    }

    if (method === 'POST' && route === '/trash') {
      const body = await readJsonBody(req)
      const p = resolveInside(body.fileName)
      if (!p) return sendJson(res, 400, { error: '非法文件名：路径越出受管文件夹' })
      if (!fs.existsSync(p)) return sendJson(res, 404, { error: '文件不存在' })
      const escaped = p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      try {
        await execFileAsync('osascript', [
          '-e',
          `tell application "Finder" to delete (POSIX file "${escaped}")`,
        ])
        return sendJson(res, 200, { ok: true })
      } catch (err) {
        return sendJson(res, 500, { error: `移到废纸篓失败：${err instanceof Error ? err.message : String(err)}` })
      }
    }

    if (method === 'POST' && route === '/import') {
      // 文件夹画布与自由画布都接受上传：文件统一写入当前受管文件夹，
      // 自由画布由前端把返回的绝对路径建成 externalPath 引用节点
      const cfg = readConfig()
      const contentType = req.headers['content-type'] ?? ''
      const m = /boundary=(?:"([^"]+)"|([^;\s]+))/.exec(contentType)
      if (!contentType.includes('multipart/form-data') || !m) {
        return sendJson(res, 400, { error: '需要 multipart/form-data 上传' })
      }
      const boundary = m[1] ?? m[2]
      const buf = await readRawBody(req, MAX_UPLOAD_BODY)
      const parts = parseMultipart(buf, boundary)
      if (parts.length === 0) return sendJson(res, 400, { error: '上传内容里没有文件' })
      const written: ImportResultItem[] = []
      for (const part of parts) {
        const base = path.basename(part.filename).trim()
        if (!base || base.startsWith('.')) continue
        const name = uniqueName(cfg.dir, base)
        const p = path.join(cfg.dir, name)
        fs.writeFileSync(p, part.data)
        const st = fs.statSync(p)
        written.push({ name, size: st.size, mtime: Math.round(st.mtimeMs), kind: 'file', path: p })
      }
      if (written.length === 0) return sendJson(res, 400, { error: '没有可写入的合法文件名' })
      return sendJson(res, 200, { files: written })
    }

    if (method === 'POST' && route === '/materialize') {
      const body = await readJsonBody(req)
      const name = typeof body.fileName === 'string' ? body.fileName.trim() : ''
      if (!name) return sendJson(res, 400, { error: '文件名不能为空' })
      if (name.includes('/') || name.includes('\\') || name.startsWith('.')) {
        return sendJson(res, 400, { error: '文件名不能包含路径分隔符，也不能以点开头' })
      }
      const p = resolveInside(name)
      if (!p) return sendJson(res, 400, { error: '非法文件名：路径越出受管文件夹' })
      if (fs.existsSync(p)) return sendJson(res, 409, { error: `文件已存在：${name}` })
      fs.writeFileSync(p, '')
      const st = fs.statSync(p)
      return sendJson(res, 200, { ok: true, file: { name, size: st.size, mtime: Math.round(st.mtimeMs), kind: 'file' } })
    }

    return sendJson(res, 404, { error: `未知接口：${method} ${route}` })
  }

  return {
    name: 'flowfiles-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        handle(req, res).catch((err: unknown) => {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        })
      })
    },
  }
}
