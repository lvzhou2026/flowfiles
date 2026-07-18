import { useState } from 'react'
import { useViewport } from 'reactflow'
import { X } from 'lucide-react'
import type { GraphFrame } from '@/types/graph'

interface Props {
  frames: GraphFrame[]
  /** 标题栏按下：开始整组拖动（成员节点跟随），由父组件接管 window 级监听 */
  onDragStart: (frameId: string, e: React.PointerEvent) => void
  /** 右下角按下：开始调整大小 */
  onResizeStart: (frameId: string, e: React.PointerEvent) => void
  onRename: (frameId: string, name: string) => void
  onDelete: (frameId: string) => void
}

/**
 * 分组框图层：作为 ReactFlow 的子元素渲染在节点层之上，
 * 但容器与框体 pointer-events: none（视觉上是半透明底色），
 * 只有标题栏、删除按钮、右下角手柄可交互。
 */
export default function FrameLayer({ frames, onDragStart, onResizeStart, onRename, onDelete }: Props) {
  const { x, y, zoom } = useViewport()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commit = (id: string) => {
    const name = draft.trim()
    if (name) onRename(id, name)
    setEditingId(null)
  }

  if (frames.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 5 }}>
      <div
        style={{
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {frames.map((f) => (
          <div
            key={f.id}
            className="group/frame absolute rounded-xl border border-blue-300/70 bg-blue-400/[0.07]"
            style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
          >
            {/* 标题栏：拖动整组 / 双击改名 */}
            <div
              className="pointer-events-auto absolute left-2 right-7 top-0.5 flex h-6 cursor-grab touch-none select-none items-center active:cursor-grabbing"
              title="拖动移动整组，双击改名"
              onPointerDown={(e) => {
                if (editingId === f.id) return
                if (e.button !== 0) return
                onDragStart(f.id, e)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setDraft(f.name)
                setEditingId(f.id)
              }}
            >
              {editingId === f.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(f.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(f.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onFocus={(e) => e.target.select()}
                  className="w-full rounded border border-blue-300 bg-white px-1 py-0 text-[11px] font-medium text-blue-800 outline-none"
                />
              ) : (
                <span className="truncate text-[11px] font-medium text-blue-700/90">{f.name}</span>
              )}
            </div>
            {/* 删除：只删框不动节点 */}
            <button
              type="button"
              className="pointer-events-auto absolute right-1 top-1 hidden h-4 w-4 items-center justify-center rounded text-blue-500/70 hover:bg-blue-100 hover:text-blue-700 group-hover/frame:flex"
              title="删除分组框（不动节点）"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onDelete(f.id)}
            >
              <X className="h-3 w-3" />
            </button>
            {/* 右下角：拖拽调整大小 */}
            <div
              className="pointer-events-auto absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none rounded-br-xl border-b-2 border-r-2 border-blue-400/0 transition-colors hover:border-blue-500/70 group-hover/frame:border-blue-400/60"
              title="拖拽调整大小"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                onResizeStart(f.id, e)
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
