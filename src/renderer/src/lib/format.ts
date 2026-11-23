import dayjs from 'dayjs'
import 'dayjs/locale/es'

dayjs.locale('es')

export { dayjs }

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min ${s} s`
  return `${s} s`
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

export function noteDateLabel(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  const date = dayjs(iso)
  if (!date.isValid()) return iso
  return date.format('D MMM YYYY · HH:mm')
}

export function dateGroupLabel(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  const date = dayjs(iso)
  if (!date.isValid()) return 'Sin fecha'
  if (date.isSame(dayjs(), 'day')) return 'Hoy'
  if (date.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Ayer'
  if (date.isAfter(dayjs().startOf('week'))) return 'Esta semana'
  if (date.isSame(dayjs(), 'month')) return 'Este mes'
  return date.format('MMMM YYYY')
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca'
  const date = dayjs(iso)
  if (!date.isValid()) return 'nunca'
  const seconds = dayjs().diff(date, 'second')
  if (seconds < 60) return 'hace un momento'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `hace ${days} d`
  return date.format('D MMM YYYY')
}

export function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}
