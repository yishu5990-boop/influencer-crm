// AI 阶段建议引擎（MVP 用关键词规则模拟，后续接入 Claude API）

const TRANSITION_RULES = [
  {
    from: '初洽',
    to: '谈价格',
    keywords: ['报价', '价格', 'rate', 'budget', '出价', '砍价', '议价', '报价$'],
    reason: '邮件中涉及报价讨论，达人可能已进入谈价格阶段',
  },
  {
    from: '谈价格',
    to: '提报待审核',
    keywords: ['接受', '成交', 'agree', 'works for me', 'confirmed', '妥'],
    reason: '价格似乎已谈妥，可以提报给主管审核',
  },
  {
    from: '提报已通过',
    to: '等待寄样',
    keywords: ['寄样', '样品', '寄出', 'ship', 'sample', 'tracking', '快递', '发货', 'DHL'],
    reason: '邮件提到寄样/发货，达人可能已进入等待寄样阶段',
  },
  {
    from: '等待寄样',
    to: '待确认',
    keywords: ['收到', 'received', '收货', '确认收', 'delivered'],
    reason: '达人已收到样品，可能进入待确认阶段',
  },
  {
    from: '待确认',
    to: '合作中',
    keywords: ['拍摄', 'filming', '创作', '制作', '下周开始', 'preview', 'draft', '审核', '草稿'],
    reason: '达人已开始创作，可能进入合作中阶段',
  },
  {
    from: '合作中',
    to: '合作完成',
    keywords: ['已发布', 'posted', 'live', 'publish', '上线', '发布', 'view', '播放', '观看'],
    reason: '内容已发布，达人可能已完成合作',
  },
  {
    from: '谈价格',
    to: '暂不提报',
    keywords: ['太贵', '价格高', '超出预算', 'above budget', '不合作', 'revisit'],
    reason: '价格可能谈不拢，建议暂不提报',
  },
  {
    from: '提报待审核',
    to: '提报未通过',
    keywords: ['不通过', '拒绝', 'rejected', 'declined'],
    reason: '提报可能未通过审核',
  },
]

// 检测当前阶段是否有建议的下一阶段
export function detectPhaseSuggestion(currentPhase, latestEmailSummary) {
  if (!latestEmailSummary) return null

  const rules = TRANSITION_RULES.filter((r) => r.from === currentPhase)
  const summaryLower = latestEmailSummary.toLowerCase()

  for (const rule of rules) {
    const matched = rule.keywords.some((kw) => summaryLower.includes(kw.toLowerCase()))
    if (matched) {
      return {
        from: rule.from,
        to: rule.to,
        reason: rule.reason,
        confidence: 0.7, // MVP 阶段固定置信度
      }
    }
  }

  return null
}
