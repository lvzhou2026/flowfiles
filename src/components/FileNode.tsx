import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import {
  File as FileIcon,
  FilePlus2,
  FileText,
  Folder as FolderIcon,
  Image as ImageIcon,
  Link2,
  StickyNote,
  Table2,
} from 'lucide-react'
import type { FileNodeData } from '@/types/graph'
import { api } from '@/lib/api'
import { extOf, fmtSize, fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])

function iconFor(name: string | null) {
  const ext = extOf(name)
  if (['md', 'markdown', 'txt', 'doc', 'docx', 'pdf', 'rtf'].includes(ext)) return FileText
  if (['csv', 'tsv', 'xls', 'xlsx', 'json'].includes(ext)) return Table2
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'heic', 'bmp'].includes(ext)) return ImageIcon
  return FileIcon
}

export default memo(function FileNode({ data, selected }: NodeProps<FileNodeData>) {
  const isDir = data.kind === 'dir'
  const isExternal = !!data.externalPath
  const displayName = data.fileName ?? data.label ?? '未命名'
  const Icon = data.placeholder ? FilePlus2 : isDir ? FolderIcon : iconFor(displayName)

  // 图片类节点：卡片顶部直接显示缩略图
  const showThumb =
    !data.placeholder &&
    !isDir &&
    !data.lost &&
    IMAGE_EXTS.has(extOf(displayName)) &&
    (data.fileName || data.externalPath)
  const thumbUrl = data.fileName
    ? api.thumbUrl({ fileName: data.fileName })
    : data.externalPath
      ? api.thumbUrl({ path: data.externalPath })
      : null

  return (
    <div
      title={displayName}
      className={cn(
        'w-[230px] rounded-xl border bg-white shadow-sm transition-shadow',
        showThumb ? 'overflow-hidden' : 'px-3 py-2.5',
        selected
          ? 'border-blue-500 shadow-md ring-2 ring-blue-500/30'
          : 'border-slate-200 hover:shadow-md',
        data.placeholder && 'border-dashed border-amber-400 bg-amber-50/60',
        data.lost && 'opacity-50 grayscale',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-white !bg-blue-500"
      />

      {showThumb && thumbUrl && (
        <img
          src={thumbUrl}
          alt={displayName}
          className="h-[90px] w-full object-cover"
          draggable={false}
        />
      )}

      <div className={cn(showThumb && 'px-3 py-2.5')}>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              data.placeholder
                ? 'bg-amber-100 text-amber-600'
                : isDir
                  ? 'bg-yellow-50 text-yellow-600'
                  : isExternal
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-blue-50 text-blue-600',
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-slate-800">{displayName}</div>
            <div className="truncate text-[11px] text-slate-400">
              {data.placeholder
                ? '占位节点'
                : data.lost
                  ? isExternal
                    ? '路径不存在'
                    : '已被外部删除'
                  : isDir
                    ? `文件夹 · ${fmtTime(data.mtime)}`
                    : `${fmtSize(data.size)} · ${fmtTime(data.mtime)}`}
            </div>
          </div>
          {data.notes.length > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
              <StickyNote className="h-3 w-3" />
              {data.notes.length}
            </span>
          )}
        </div>

        {(data.placeholder || data.lost || isExternal) && (
          <div className="mt-1.5 flex items-center gap-1">
            {data.placeholder && (
              <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                待补文件
              </span>
            )}
            {data.lost && (
              <span className="inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                已丢失
              </span>
            )}
            {isExternal && (
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                <Link2 className="h-2.5 w-2.5" />
                外部引用
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
