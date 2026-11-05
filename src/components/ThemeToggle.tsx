import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../store/theme'
import { useI18n } from '../i18n'

export function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  const { t } = useI18n()
  const next = resolved === 'dark' ? 'light' : 'dark'
  const label = t(`Switch to ${next} mode`)
  return (
    <button className="icon-btn" onClick={toggle} aria-label={label} title={label}>
      {resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
