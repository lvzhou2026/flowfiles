import type { Graph, ImportedFile, StateResponse } from '@/types/graph'

/** 打开 / 预览的目标：受管文件夹内的文件名，或外部引用的绝对路径 */
export type OpenTarget = { fileName: string } | { path: string }

function mediaQuery(t: OpenTarget): string {
  return 'fileName' in t
    ? `name=${encodeURIComponent(t.fileName)}`
    : `path=${encodeURIComponent(t.path)}`
}

async function request<T>(url: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `请求失败 (${res.status})`)
  }
  return data as T
}

async function requestForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: form })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `请求失败 (${res.status})`)
  }
  return data as T
}

export const api = {
  state: () => request<StateResponse>('/api/state'),
  setDir: (dir: string) => request<StateResponse>('/api/dir', 'POST', { dir }),
  saveGraph: (graph: Graph) => request<{ ok: true }>('/api/graph', 'POST', graph),

  createCanvas: (name: string) => request<StateResponse>('/api/canvas', 'POST', { name }),
  switchCanvas: (kind: 'dir' | 'canvas', id: string) =>
    request<StateResponse>('/api/canvas/switch', 'POST', { kind, id }),
  renameCanvas: (id: string, name: string) =>
    request<StateResponse>('/api/canvas/rename', 'POST', { id, name }),
  deleteCanvas: (id: string) => request<StateResponse>('/api/canvas/delete', 'POST', { id }),

  open: (target: OpenTarget) => request<{ ok: true }>('/api/open', 'POST', target),
  reveal: (target: OpenTarget) => request<{ ok: true }>('/api/reveal', 'POST', target),
  locate: (fileName: string) => request<{ path: string }>('/api/locate', 'POST', { fileName }),
  stat: (path: string) =>
    request<{ path: string; name: string; size: number; mtime: number; kind: 'file' | 'dir' }>(
      '/api/stat',
      'POST',
      { path },
    ),
  trash: (fileName: string) => request<{ ok: true }>('/api/trash', 'POST', { fileName }),
  materialize: (fileName: string) => request<{ ok: true }>('/api/materialize', 'POST', { fileName }),

  importFiles: (form: FormData) => requestForm<{ files: ImportedFile[] }>('/api/import', form),

  thumbUrl: (target: OpenTarget) => `/api/thumb?${mediaQuery(target)}`,
  preview: (target: OpenTarget) =>
    request<{ text: string; truncated: boolean }>(`/api/preview?${mediaQuery(target)}`),
}
