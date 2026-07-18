import { ExternalLink } from 'lucide-react'
import type { Node } from 'reactflow'
import type { FileNodeData } from '@/types/graph'
import { fmtSize, fmtTime } from '@/lib/format'
import FilePreview, { previewKindOf } from '@/components/FilePreview'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  node: Node<FileNodeData> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenFile: (node: Node<FileNodeData>) => void
}

/**
 * 空格键快速预览（类 QuickLook 体验）。
 * TODO(Tauri): 桌面化阶段换成 macOS 系统级 QuickLook（QLPreviewPanel），
 * 届时本弹窗仅作为浏览器内的降级方案保留。
 */
export default function QuickLookDialog({ node, open, onOpenChange, onOpenFile }: Props) {
  const data = node?.data ?? null
  const kind = data ? previewKindOf(data) : 'other'
  const name = data?.fileName ?? data?.label ?? '未命名'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="truncate pr-6 text-sm">{name}</DialogTitle>
        </DialogHeader>
        {data && (
          <div className="space-y-3">
            {kind !== 'other' && !data.lost ? (
              <FilePreview data={data} large />
            ) : (
              <div className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                {data.externalPath && (
                  <div className="break-all">
                    路径：<span className="font-mono">{data.externalPath}</span>
                  </div>
                )}
                <div>
                  {data.kind === 'dir' ? '文件夹' : '文件'} · {fmtSize(data.size)} · 修改于{' '}
                  {fmtTime(data.mtime)}
                </div>
                {data.lost && <div className="font-medium text-red-500">文件已丢失，无法预览</div>}
                {!data.lost && kind === 'other' && <div>该文件类型暂不支持内嵌预览</div>}
              </div>
            )}
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={data.lost || (!data.fileName && !data.externalPath)}
                onClick={() => node && onOpenFile(node)}
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                打开文件
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
