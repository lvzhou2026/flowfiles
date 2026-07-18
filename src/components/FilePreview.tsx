import { useEffect, useState } from 'react'
import { api, type OpenTarget } from '@/lib/api'
import type { FileNodeData } from '@/types/graph'
import { extOf } from '@/lib/format'
import { cn } from '@/lib/utils'

export type PreviewKind = 'image' | 'pdf' | 'text' | 'other'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])
const TEXT_EXTS = new Set([
  'md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'log',
  'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'htm', 'xml',
  'yml', 'yaml', 'toml', 'ini', 'sh', 'py', 'conf', 'cfg',
])

/** 节点对应的可预览目标：受管文件夹内文件走 fileName，外部引用走绝对路径 */
export function previewTarget(data: FileNodeData): OpenTarget | null {
  if (data.fileName) return { fileName: data.fileName }
  if (data.externalPath) return { path: data.externalPath }
  return null
}

export function previewKindOf(data: FileNodeData): PreviewKind {
  const ext = extOf(data.fileName ?? data.externalPath)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'other'
}

interface Props {
  data: FileNodeData
  /** large 用于空格预览弹窗（更大的图 / embed 高度） */
  large?: boolean
}

/** 侧栏 / 弹窗共用的文件预览：图片大图、pdf 走浏览器原生渲染、文本等宽摘录 */
export default function FilePreview({ data, large }: Props) {
  const kind = previewKindOf(data)
  const target = previewTarget(data)
  const targetKey = target ? JSON.stringify(target) : ''
  const [text, setText] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setText(null)
    setTruncated(false)
    setError('')
    if (kind !== 'text' || !target) return
    let alive = true
    api
      .preview(target)
      .then((r) => {
        if (!alive) return
        setText(r.text)
        setTruncated(r.truncated)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, targetKey])

  if (!target) return null

  if (kind === 'image') {
    return (
      <img
        src={api.thumbUrl(target)}
        alt={data.fileName ?? data.label ?? '图片预览'}
        className={cn(
          'w-full rounded-lg border border-slate-200 bg-slate-100 object-contain',
          large ? 'max-h-[60vh]' : 'max-h-[240px]',
        )}
        draggable={false}
      />
    )
  }

  if (kind === 'pdf') {
    return (
      <embed
        src={api.thumbUrl(target)}
        type="application/pdf"
        className={cn(
          'w-full rounded-lg border border-slate-200 bg-white',
          large ? 'h-[60vh]' : 'h-[240px]',
        )}
      />
    )
  }

  if (kind === 'text') {
    return (
      <div>
        <pre
          className={cn(
            'overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-600',
            large ? 'max-h-[50vh]' : 'max-h-[180px]',
          )}
        >
          {error ? `预览失败：${error}` : (text ?? '加载中…')}
        </pre>
        {!error && truncated && (
          <p className="mt-1 text-[10px] text-slate-400">仅显示前 800 字符</p>
        )}
      </div>
    )
  }

  return null
}
