import { useEffect, useState } from 'react'
import { Square } from 'lucide-react'
import { useI18n } from '../../i18n'

const STAGES = ['Thinking…', 'Reading your message…', 'Putting the answer together…', 'Still working on it…']

/**
 * Pre-first-token loader for chat answers: a pixel equalizer, shimmering answer lines and a rotating status with a live timer.
 * It is indeterminate on purpose (no fake percentages) and respects reduced-motion via the global rules.
 */
export function ThinkingLoader({ label, onStop }: { label?: string; onStop?: () => void }) {
  const { t } = useI18n()
  const [sec, setSec] = useState(0)
  useEffect(() => { const i = window.setInterval(() => setSec((s) => s + 1), 1000); return () => window.clearInterval(i) }, [])
  const stage = sec < 3 ? 0 : sec < 8 ? 1 : sec < 20 ? 2 : 3
  return (
    <div className="think" role="status" aria-live="polite" aria-label={t('Forked AI is thinking')}>
      <div className="think__row">
        <span className="think__eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <span className="think__label" key={label ?? stage}>{t(label ?? STAGES[stage])}</span>
        <span className="think__time mono">{sec}s</span>
        {onStop && <button type="button" className="think__stop" onClick={onStop} aria-label={t('Stop')}><Square size={11} fill="currentColor" /> {t('Stop')}</button>}
      </div>
      <div className="think__lines" aria-hidden="true"><b /><b /><b /></div>
    </div>
  )
}
