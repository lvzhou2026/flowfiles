import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow'
import type { EdgeData } from '@/types/graph'
import { relationStyle } from '@/lib/relations'

/**
 * 关系连线：贝塞尔曲线 + HTML 标签。
 * 第一行是关系类型（迭代/引用/相关），备注内容显示在关系词下面一行。
 */
export default function RelationEdge(props: EdgeProps<EdgeData>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style, markerEnd } = props
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const s = relationStyle(data?.relation ?? '')

  return (
    <>
      <BaseEdge path={path} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-none absolute flex flex-col items-center gap-0.5 rounded-md bg-white/85 px-1.5 py-0.5"
          style={{
            transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 4}px)`,
          }}
        >
          <span className="text-[11px] font-medium leading-tight" style={{ color: s.stroke }}>
            {data?.relation ?? '相关'}
          </span>
          {data?.note && (
            <span
              title={data.note}
              className="max-w-[200px] truncate text-[10px] leading-tight text-slate-500"
            >
              {data.note}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
