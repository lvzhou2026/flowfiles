import { useState } from 'react'
import { FolderClosed, LayoutDashboard, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { ActiveCanvas, CanvasMeta } from '@/types/graph'
import { baseName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Props {
  dir: string
  recentDirs: string[]
  canvases: CanvasMeta[]
  activeCanvas: ActiveCanvas
  onSwitchDir: (path: string) => Promise<void>
  onSwitchCanvas: (id: string) => Promise<void>
  onCreateCanvas: (name: string) => Promise<void>
  onRenameCanvas: (id: string, name: string) => Promise<void>
  onDeleteCanvas: (id: string) => Promise<void>
}

/** 左侧画布栏：文件夹画布（最近文件夹）+ 自由画布（新建 / 重命名 / 删除） */
export default function CanvasSidebar(props: Props) {
  const { dir, recentDirs, canvases, activeCanvas } = props
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [renameTarget, setRenameTarget] = useState<CanvasMeta | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<CanvasMeta | null>(null)
  const [busy, setBusy] = useState(false)

  // activeCanvas 可能尚未规范化（例如画布刚被删），回退到当前 dir
  const activeDirPath = activeCanvas.kind === 'dir' ? activeCanvas.id : dir

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-r border-slate-200 bg-white">
      <ScrollArea className="flex-1">
        <div className="space-y-5 px-2.5 py-3">
          {/* 文件夹画布 */}
          <section>
            <h3 className="px-1.5 pb-1.5 text-[11px] font-semibold tracking-wide text-slate-400">
              文件夹画布
            </h3>
            <ul className="space-y-0.5">
              {recentDirs.map((p) => {
                const active = activeCanvas.kind === 'dir' && activeDirPath === p
                return (
                  <li key={p}>
                    <button
                      type="button"
                      title={p}
                      disabled={busy}
                      onClick={() => !active && void run(() => props.onSwitchDir(p))}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs transition-colors',
                        active
                          ? 'bg-blue-50 font-medium text-blue-700'
                          : 'text-slate-600 hover:bg-slate-100',
                      )}
                    >
                      <FolderClosed
                        className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-blue-600' : 'text-slate-400')}
                      />
                      <span className="min-w-0 flex-1 truncate">{baseName(p) || p}</span>
                    </button>
                  </li>
                )
              })}
              {recentDirs.length === 0 && (
                <li className="px-1.5 text-[11px] text-slate-400">暂无最近文件夹</li>
              )}
            </ul>
          </section>

          {/* 自由画布 */}
          <section>
            <div className="flex items-center justify-between px-1.5 pb-1.5">
              <h3 className="text-[11px] font-semibold tracking-wide text-slate-400">自由画布</h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-slate-400 hover:text-slate-700"
                title="新建画布"
                onClick={() => {
                  setCreateName('')
                  setCreateOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <ul className="space-y-0.5">
              {canvases.map((c) => {
                const active = activeCanvas.kind === 'canvas' && activeCanvas.id === c.id
                return (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      title={c.name}
                      disabled={busy}
                      onClick={() => !active && void run(() => props.onSwitchCanvas(c.id))}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 pr-7 text-left text-xs transition-colors',
                        active
                          ? 'bg-blue-50 font-medium text-blue-700'
                          : 'text-slate-600 hover:bg-slate-100',
                      )}
                    >
                      <LayoutDashboard
                        className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-blue-600' : 'text-slate-400')}
                      />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute right-0.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-600"
                          title="画布操作"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="right" className="w-32">
                        <DropdownMenuItem
                          onClick={() => {
                            setRenameTarget(c)
                            setRenameName(c.name)
                          }}
                        >
                          重命名
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-600"
                          onClick={() => setDeleteTarget(c)}
                        >
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                )
              })}
              {canvases.length === 0 && (
                <li className="px-1.5 text-[11px] text-slate-400">
                  点右上角 + 新建一块自由画布
                </li>
              )}
            </ul>
          </section>
        </div>
      </ScrollArea>

      {/* 新建画布 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>新建自由画布</DialogTitle>
            <DialogDescription>
              自由画布不绑定文件夹，可以把任意文件（包括受管文件夹之外的）放上来组织关系。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label>画布名称</Label>
            <Input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="例如：季度规划"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && createName.trim()) {
                  void run(async () => {
                    await props.onCreateCanvas(createName.trim())
                    setCreateOpen(false)
                  })
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={busy || !createName.trim()}
              onClick={() =>
                void run(async () => {
                  await props.onCreateCanvas(createName.trim())
                  setCreateOpen(false)
                })
              }
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 重命名画布 */}
      <Dialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>重命名画布</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label>新名称</Label>
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameTarget && renameName.trim()) {
                  void run(async () => {
                    await props.onRenameCanvas(renameTarget.id, renameName.trim())
                    setRenameTarget(null)
                  })
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button
              disabled={busy || !renameName.trim()}
              onClick={() =>
                renameTarget &&
                void run(async () => {
                  await props.onRenameCanvas(renameTarget.id, renameName.trim())
                  setRenameTarget(null)
                })
              }
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除画布 */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除画布「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              画布上的节点摆位、连线和备注都会被删除，文件本身不受影响。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={() =>
                deleteTarget &&
                void run(async () => {
                  await props.onDeleteCanvas(deleteTarget.id)
                  setDeleteTarget(null)
                })
              }
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
