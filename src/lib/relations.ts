export const RELATIONS = ['迭代', '引用', '相关'] as const

/** 迭代=实线品牌蓝；引用/相关=虚线 */
export const RELATION_STYLES: Record<string, { stroke: string; dash?: string; width: number }> = {
  迭代: { stroke: '#2563eb', width: 2 },
  引用: { stroke: '#7c3aed', dash: '6 4', width: 1.5 },
  相关: { stroke: '#94a3b8', dash: '6 4', width: 1.5 },
}

export function relationStyle(relation: string) {
  return RELATION_STYLES[relation] ?? RELATION_STYLES['相关']
}
