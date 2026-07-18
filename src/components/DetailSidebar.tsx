import { useEffect, useMemo, useState } from 'react'
import type { Edge, Node } from 'reactflow'
import { ExternalLink, FolderSearch, MapPin, Trash2, X } from 'lucide-react'
import type { EdgeData, FileInfo, FileNodeData } from '@/types/graph'
import { fmtSize, fmtTime } from '@/lib/format'
import { relationStyle } from '@/lib/relations'
import FilePreview from '@/components/FilePreview'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export type FNode = Node<FileNodeData>
export type FEdge = Edge<EdgeData>

interface Props {
  node: FNode | null
  edge: FEdge | null
  nodes: FNode[]
  files: FileInfo[]
  onClose: () => void
  onOpenFile: (node: FNode) => void
  onRevealFile: (node: FNode) => void
  onAddNote: (nodeId: string, text: string) => void
  onDeleteNote: (nodeId: string, index: number) => void
  onMaterialize: (nodeId: string, fileName: string) => Promise<void>
  onAssociate: (nodeId: string, fileName: string) => void
  onUpdateEdgeNote: (edgeId: string, note: string) => void
  onDeleteEdge: (edgeId: string) => void
  /** 仅从画布移除节点，不动文件 */
  onRemoveNode: (nodeId: string) => void
  /** 把受管文件夹内的文件移到废纸篓（确认后调用） */
  onTrashNode: (node: FNode) => Promise<void>
  /** 外部引用丢失后按文件名重新定位 */
  onRelocate: (node: FNode) => Promise<void>
}

function displayName(n: FNode): string {
  return n.data.fileName ?? n.data.label ?? '未命名'
}

export default function DetailSidebar(props: Props) {
  const { node, edge, nodes, files, onClose } = props
  const [noteDraft, setNoteDraft] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [edgeNoteDraft, setEdgeNoteDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)

  const nodeId = node?.id ?? null
  const edgeId = edge?.id ?? null

  useEffect(() => {
    setNoteDraft('')
    setError('')
    setTrashOpen(false)
    setNameDraft(node?.data.label ?? node?.data.fileName ?? '')
  }, [nodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setEdgeNoteDraft(edge?.data?.note ?? '')
  }, [edgeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 文件夹里尚未被任何文件节点使用的文件（可供占位节点直接关联）
  const unassociated = useMemo(() => {
    const used = new Set(
      nodes.filter((n) => !n.data.placeholder && n.data.fileName).map((n) => n.data.fileName),
    )
    return files.filter((f) => !used.has(f.name))
  }, [nodes, files])

  if (!node && !edge) return null

  const resolveName = (id: string) => {
    const n = nodes.find((x) => x.id === id)
    return n ? displayName(n) : id
  }

  const isExternal = !!node?.data.externalPath
  const canTrash =
    !!node && !node.data.placeholder && !isExternal && !!node.data.fileName && !node.data.lost
  const canOpen = !!node && !node.data.lost && (!!node.data.fileName || isExternal)

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">
          {edge
            ? '连线详情'
            : node?.data.placeholder
              ? '占位节点'
              : isExternal
                ? '外部引用'
                : node?.data.kind === 'dir'
                  ? '文件夹详情'
                  : '文件详情'}
        </h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 px-4 py-4">
          {node && !node.data.placeholder && (
            <>
              {/* 预览区：图片大图 / pdf embed / 文本摘录 */}
              {!node.data.lost && node.data.kind !== 'dir' && (
                <FilePreview data={node.data} />
              )}

              <div>
                <div className="break-all text-sm font-medium text-slate-800">
                  {displayName(node)}
                </div>
                {node.data.externalPath && (
                  <div
                    className="mt-0.5 break-all font-mono text-[10px] text-slate-400"
                    title={node.data.externalPath}
                  >
                    {node.data.externalPath}
                  </div>
                )}
                <div className="mt-1 text-xs text-slate-400">
                  {node.data.kind === 'dir'
                    ? `文件夹 · 修改于 ${fmtTime(node.data.mtime)}`
                    : `${fmtSize(node.data.size)} · 修改于 ${fmtTime(node.data.mtime)}`}
                </div>
                {node.data.lost && (
                  <div className="mt-1 text-xs font-medium text-red-500">
                    {isExternal
                      ? '路径不存在，外部引用已断线'
                      : `${node.data.kind === 'dir' ? '文件夹' : '文件'}已被外部删除，节点仅保留画布记录`}
                  </div>
                )}
              </div>

              {isExternal && node.data.lost && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setError('')
                    try {
                      await props.onRelocate(node)
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  <MapPin className="mr-1 h-3.5 w-3.5" />
                  按文件名重新定位
                </Button>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={!canOpen}
                  onClick={() => props.onOpenFile(node)}
                >
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                  {node.data.kind === 'dir' ? '打开文件夹' : '打开文件'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={!canOpen}
                  onClick={() => props.onRevealFile(node)}
                >
                  <FolderSearch className="mr-1 h-3.5 w-3.5" />
                  在 Finder 中显示
                </Button>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => props.onRemoveNode(node.id)}
                >
                  从画布移除
                </Button>
                {canTrash && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    onClick={() => setTrashOpen(true)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    移到废纸篓
                  </Button>
                )}
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}

              <Separator />
            </>
          )}

          {node && node.data.placeholder && (
            <>
              <div className="grid gap-1.5">
                <Label>目标文件名</Label>
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="例如 launch-checklist.md"
                />
                <p className="text-xs text-slate-400">
                  创建后占位节点将转为真实文件节点；也可从下方直接关联文件夹里尚未上画布的文件。
                </p>
              </div>
              <Button
                size="sm"
                className="w-full"
                disabled={busy || !nameDraft.trim()}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    await props.onMaterialize(node.id, nameDraft.trim())
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                创建文件并关联
              </Button>
              {unassociated.length > 0 && (
                <div className="grid gap-1.5">
                  <Label>或关联已有文件</Label>
                  <Select onValueChange={(v) => props.onAssociate(node.id, v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择未上画布的文件" />
                    </SelectTrigger>
                    <SelectContent>
                      {unassociated.map((f) => (
                        <SelectItem key={f.name} value={f.name}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {error && <p className="text-xs text-red-500">{error}</p>}
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => props.onRemoveNode(node.id)}
              >
                从画布移除
              </Button>
              <Separator />
            </>
          )}

          {node && (
            <div className="space-y-2">
              <Label>备注（{node.data.notes.length}）</Label>
              {node.data.notes.length === 0 && (
                <p className="text-xs text-slate-400">还没有备注，写一条吧。</p>
              )}
              <ul className="space-y-2">
                {node.data.notes.map((n, i) => (
                  <li
                    key={i}
                    className="group flex items-start gap-1.5 rounded-lg bg-slate-50 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-slate-700">{n.text}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">{fmtTime(n.at)}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-slate-300 hover:text-red-500"
                      title="删除这条备注"
                      onClick={() => props.onDeleteNote(node.id, i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="追加备注…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && noteDraft.trim()) {
                      props.onAddNote(node.id, noteDraft.trim())
                      setNoteDraft('')
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!noteDraft.trim()}
                  onClick={() => {
                    props.onAddNote(node.id, noteDraft.trim())
                    setNoteDraft('')
                  }}
                >
                  添加
                </Button>
              </div>
            </div>
          )}

          {edge && (
            <>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: relationStyle(edge.data?.relation ?? '').stroke }}
                  >
                    {edge.data?.relation ?? '相关'}
                  </span>
                </div>
                <div className="break-all text-xs text-slate-500">
                  {resolveName(edge.source)} → {resolveName(edge.target)}
                </div>
                <div className="text-[10px] text-slate-400">
                  创建于 {fmtTime(edge.data?.at)}
                </div>
              </div>
              <Separator />
              <div className="grid gap-1.5">
                <Label>备注</Label>
                <Textarea
                  value={edgeNoteDraft}
                  onChange={(e) => setEdgeNoteDraft(e.target.value)}
                  rows={3}
                  placeholder="这条连线代表什么？"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => props.onUpdateEdgeNote(edge.id, edgeNoteDraft.trim())}
                >
                  保存备注
                </Button>
              </div>
              <Separator />
              <Button
                size="sm"
                variant="destructive"
                className="w-full"
                onClick={() => props.onDeleteEdge(edge.id)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                删除连线
              </Button>
            </>
          )}
        </div>
      </ScrollArea>

      {/* 移到废纸篓确认 */}
      <AlertDialog open={trashOpen} onOpenChange={setTrashOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>把「{node ? displayName(node) : ''}」移到废纸篓？</AlertDialogTitle>
            <AlertDialogDescription>
              文件会被移入 macOS 废纸篓（可从废纸篓恢复），画布上的节点会随之消失。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={async () => {
                if (!node) return
                setBusy(true)
                setError('')
                try {
                  await props.onTrashNode(node)
                  setTrashOpen(false)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                  setTrashOpen(false)
                } finally {
                  setBusy(false)
                }
              }}
            >
              移到废纸篓
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
