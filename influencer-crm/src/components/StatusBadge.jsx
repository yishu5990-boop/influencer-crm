const COLOR_MAP = {
  blue: 'badge-chutan',
  orange: 'badge-tanjiage',
  pink: 'badge-dengjijiyang',
  purple: 'badge-daiqueren',
  green: 'badge-hezuozhong',
  gray: 'badge-hezuowancheng',
  red: 'badge-yigezhi',
}

export default function StatusBadge({ label, color = 'gray', type = 'status' }) {
  const cls = type === 'report' ? `badge-weitibao` : COLOR_MAP[color] || 'badge-hezuowancheng'

  return <span className={`badge ${cls}`}>{label}</span>
}
