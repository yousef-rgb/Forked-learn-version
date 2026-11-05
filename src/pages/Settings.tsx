import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button, Card, Modal } from '../components/ui'
import { useTheme, type ThemePref } from '../store/theme'
import { LANGS, useI18n } from '../i18n'
import { useAuth } from '../store/auth'
import { useGame } from '../store/game'
import { useToast } from '../store/toast'

const KEY = 'quest.settings'
interface Local { sound: boolean; language: string; reminders: boolean; achNotes: boolean; weekly: boolean; show: boolean }
const defaults: Local = { sound: false, language: 'en', reminders: true, achNotes: true, weekly: false, show: true }
const load = (): Local => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return defaults } }

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="setrow">
      <div><label htmlFor={id}><strong>{label}</strong></label>{hint && <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>{hint}</span>}</div>
      <button id={id} role="switch" aria-checked={checked} className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}><span /></button>
    </div>
  )
}

export default function Settings() {
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme, motion, setMotion, fontScale, setFontScale } = useTheme()
  const { reset } = useGame()
  const { user, updateProfile } = useAuth()
  const { toast } = useToast()
  const [s, setS] = useState<Local>(load)
  const [confirm, setConfirm] = useState(false)
  const set = <K extends keyof Local>(k: K, v: Local[K]) => setS((p) => { const n = { ...p, [k]: v }; try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* ignore */ } return n })
  const setDaily = async (m: number) => {
    try { await updateProfile({ dailyMinutes: m }); toast({ kind: 'success', title: t('Daily goal saved') }) }
    catch (err) { toast({ kind: 'error', title: t('Could not save your daily goal'), body: err instanceof Error ? err.message : t('Please try again.') }) }
  }
  const themes: { id: ThemePref; label: string; icon: typeof Sun }[] = [{ id: 'light', label: t('Light'), icon: Sun }, { id: 'dark', label: t('Dark'), icon: Moon }, { id: 'system', label: t('System'), icon: Monitor }]

  return (
    <div className="page page--narrow">
      <header className="page__head"><div><p className="muted">{t('Appearance and preferences are saved in this browser. Your progress is saved to your account.')}</p><h1 className="page__title">{t('Settings')}</h1></div></header>

      <Card className="set"><h2 className="h-sm">{t('Appearance')}</h2>
        <div className="seg seg--lg" role="radiogroup" aria-label={t('Theme')}>{themes.map((t) => <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? 'is-on' : ''} onClick={() => setTheme(t.id)}><t.icon size={16} /> {t.label}</button>)}</div>
        <div className="setrow"><div><strong>{t('Font size')}</strong><span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>{t('Scales all text across the app.')}</span></div>
          <div className="seg" role="radiogroup" aria-label={t('Font size')}>{[{ l: 'A', v: 0.9, a: t('Small') }, { l: 'A', v: 1, a: t('Default') }, { l: 'A', v: 1.15, a: t('Large') }].map((o, i) => <button key={o.a} role="radio" aria-label={o.a} aria-checked={fontScale === o.v} className={fontScale === o.v ? 'is-on' : ''} style={{ fontSize: 12 + i * 3 }} onClick={() => setFontScale(o.v)}>{o.l}</button>)}</div></div>
      </Card>

      <Card className="set"><h2 className="h-sm">{t('Accessibility')}</h2>
        <Toggle id="motion" label={t('Reduce animations')} hint={t('Turns off page transitions and motion effects.')} checked={motion === 'reduced'} onChange={(v) => setMotion(v ? 'reduced' : 'full')} />
        <Toggle id="sound" label={t('Sound effects')} hint={t('Preference is saved; audio effects arrive in a later release.')} checked={s.sound} onChange={(v) => set('sound', v)} />
      </Card>

      <Card className="set"><h2 className="h-sm">{t('Language')}</h2>
        <div className="setrow"><div><label htmlFor="lang"><strong>{t('Interface language')}</strong></label><span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>{t('Switches the whole platform, including right-to-left layout for Arabic.')}</span></div>
          <select id="lang" className="input" style={{ width: 160 }} value={lang} onChange={(e) => { const r = e.currentTarget.getBoundingClientRect(); setLang(e.target.value as 'en' | 'ar', { x: r.left + r.width / 2, y: r.top + r.height / 2 }) }}>{LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></div>
      </Card>

      <Card className="set"><h2 className="h-sm">{t('Learning preferences')}</h2>
        <div className="setrow"><div><label htmlFor="daily"><strong>{t('Daily goal')}</strong></label><span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>{t('Minutes you plan to learn each day.')}</span></div>
          <select id="daily" className="input" style={{ width: 140 }} value={user?.dailyMinutes ?? 20} onChange={(e) => void setDaily(Number(e.target.value))}>{[10, 20, 30, 60].map((m) => <option key={m} value={m}>{m} {t('min')}</option>)}</select></div>
        <Toggle id="show" label={t('Show hints by default')} checked={s.show} onChange={(v) => set('show', v)} />
      </Card>

      <Card className="set"><h2 className="h-sm">{t('Notifications')}</h2>
        <Toggle id="rem" label={t('Daily quest reminders')} hint={t('Preference is saved; reminders are not sent yet.')} checked={s.reminders} onChange={(v) => set('reminders', v)} />
        <Toggle id="ach" label={t('Achievement and level-up alerts')} checked={s.achNotes} onChange={(v) => set('achNotes', v)} />
        <Toggle id="week" label={t('Weekly progress summary')} hint={t('Preference is saved; summaries are not sent yet.')} checked={s.weekly} onChange={(v) => set('weekly', v)} />
      </Card>

      <Card className="set"><h2 className="h-sm">{t('Account & progress')}</h2>
        <p className="muted">{t('Signed in as')} <strong>{user?.email}</strong>. {t('Your progress is saved to your account and follows you to any device.')}</p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Button onClick={() => setConfirm(true)}>{t('Reset progress')}</Button>
        </div>
      </Card>

      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('Reset all progress?')}>
        <p className="muted">{t('This permanently clears XP, completed lessons, notes and bookmarks on your account, on every device. It cannot be undone.')}</p>
        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}><Button variant="ghost" onClick={() => setConfirm(false)}>{t('Cancel')}</Button><Button variant="primary" onClick={() => { reset(); toast({ kind: 'success', title: t('Progress reset') }); setConfirm(false) }}>{t('Reset everything')}</Button></div>
      </Modal>
    </div>
  )
}
