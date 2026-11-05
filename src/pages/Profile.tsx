import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { ACHIEVEMENTS, COURSES, QUESTS, lessonById, questById } from '../data/curriculum'
import { Button, Card, CountUp, Modal, PixelIcon, ProgressBar } from '../components/ui'
import { ActivityCalendar } from '../components/Charts'
import { Character, CHARACTERS } from '../components/Character'
import { Field } from '../components/forms'
import { courseProgress, learningMinutes, questStatus, snapshot } from '../store/engine'
import { useAuth } from '../store/auth'
import { useGame } from '../store/game'
import { useToast } from '../store/toast'
import { useI18n } from '../i18n'
import type { Achievement } from '../types'

export default function Profile() {
  const { t, locale } = useI18n()
  const { user, updateProfile } = useAuth()
  const { state, xp, level } = useGame()
  const { toast } = useToast()
  const snap = snapshot(state)
  const [edit, setEdit] = useState(false)
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [err, setErr] = useState<{ name?: string; username?: string }>({})
  const [detail, setDetail] = useState<Achievement | null>(null)
  if (!user) return null

  const rows = ACHIEVEMENTS.map((a) => ({ a, r: a.check(snap) }))
  const unlocked = rows.filter((x) => x.r.done).length
  const history = Object.entries(state.completedLessons).filter(([id]) => lessonById(id)).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 8)
  const cleared = QUESTS.filter((q) => ['completed', 'mastered'].includes(questStatus(state, q)))
  const save = async () => {
    const e: typeof err = {}
    if (name.trim().length < 2) e.name = t('At least 2 characters.')
    if (!/^[a-z0-9_]{3,16}$/i.test(username)) e.username = t('3–16 letters, numbers or underscores.')
    setErr(e)
    if (Object.keys(e).length) return
    try {
      await updateProfile({ name: name.trim(), username: username.toLowerCase() })
      setEdit(false); toast({ kind: 'success', title: t('Profile updated') })
    } catch (e2) {
      toast({ kind: 'error', title: t('Could not update your profile'), body: e2 instanceof Error ? e2.message : t('Please try again.') })
    }
  }

  return (
    <div className="page">
      <Card className="pf-hero">
        <span className="avatar avatar--lg">{user.name.charAt(0).toUpperCase()}</span>
        <div className="pf-hero__id">
          <h1 className="page__title">{user.name}</h1>
          <span className="muted mono">@{user.username}</span>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}><span className="chip chip--blue">{t('LV')} {level.level}</span><span className="chip chip--soft">{t(level.rank)}</span>{user.goal && <span className="chip chip--soft">{user.goal}</span>}</div>
        </div>
        <div className="pf-hero__xp"><div className="row" style={{ gap: 12 }}><Character stage={level.level - 1} size={64} label /><div style={{ display: 'grid' }}><strong style={{ fontFamily: 'var(--font-heading)', fontSize: '1.3rem' }}>{t(level.rank)}</strong><span className="muted" style={{ fontSize: '0.78rem' }}>{t(CHARACTERS[level.level - 1].title)}</span></div></div><span className="mono pf-xp"><CountUp value={xp} /> XP</span><ProgressBar value={level.pct} label={t('Progress to next rank')} /><span className="muted" style={{ fontSize: '0.8rem' }}>{level.nextRank ? t('{xp} XP to {rank}', { xp: level.toNext, rank: t(level.nextRank) }) : t('Max rank')}</span></div>
        <Button icon={<Pencil size={14} />} onClick={() => { setName(user.name); setUsername(user.username); setEdit(true) }}>{t('Edit profile')}</Button>
      </Card>

      <section className="stats-row" aria-label={t('Learning statistics')}>
        {[{ l: t('Lessons done'), v: Object.keys(state.completedLessons).length }, { l: t('Quests cleared'), v: cleared.length }, { l: t('Current streak'), v: snap.streak }, { l: t('Longest streak'), v: snap.longestStreak }, { l: t('Hours learned'), v: Math.round((learningMinutes(state) / 60) * 10) / 10 }, { l: t('Badges'), v: `${unlocked}/${ACHIEVEMENTS.length}` }].map((s) => (
          <Card key={s.l} pad={false} className="tile"><span className="tile__v mono">{s.v}</span><span className="tile__l">{s.l}</span></Card>
        ))}
      </section>

      <div className="pf-grid">
        <Card><h3>{t('Achievement showcase')}</h3>
          <div className="ach-wall">
            {rows.map(({ a, r }) => (
              <button key={a.id} className={`ach-card ${r.done ? '' : 'is-locked'}`} onClick={() => setDetail(a)} aria-label={`${t(a.title)}, ${r.done ? t('Unlocked') : t(r.label)}`}>
                <PixelIcon name={a.icon} size={44} /><strong>{t(a.title)}</strong><span className="muted">{r.done ? t('Unlocked') : t(r.label)}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card><h3>{t('Skills')}</h3>
          <div className="skills">{COURSES.map((c) => { const p = courseProgress(state, c.id); return (
            <div key={c.id} className="skill"><div className="row" style={{ justifyContent: 'space-between' }}><span className="row"><PixelIcon name={c.icon} size={24} /><strong>{t(c.title)}</strong></span><span className="mono">{p.pct}%</span></div><ProgressBar value={p.pct} small label={t(c.title)} /></div>
          ) })}</div>
          <h3 style={{ marginTop: 24 }}>{t('Activity')}</h3><ActivityCalendar state={state} compact />
        </Card>
        <Card><h3>{t('Learning history')}</h3>
          {history.length === 0 ? <p className="muted">{t('Complete a lesson to start your history.')}</p> : <ul className="list">{history.map(([id, rec]) => { const l = lessonById(id)!; return <li key={id}><div className="list__main"><strong>{t(l.title)}</strong><span className="muted">{t(questById(l.questId)?.title ?? '')}</span></div>{rec.perfect && <span className="chip chip--done">{t('Perfect')}</span>}<span className="mono muted" style={{ fontSize: '0.75rem' }}>{new Date(rec.at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span></li> })}</ul>}
        </Card>
        <Card><h3>{t('Project portfolio')}</h3><div className="empty" style={{ padding: 24 }}><PixelIcon name="rocket" size={44} /><p className="muted">{t('The Project Workshop opens in a later release. Finished projects will appear here.')}</p></div></Card>
      </div>

      <Modal open={edit} onClose={() => setEdit(false)} title={t('Edit profile')}>
        <div className="grid" style={{ gap: 14 }}>
          <Field label={t('Display name')} error={err.name}>{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label={t('Username')} error={err.username}>{(p) => <input {...p} className="input" value={username} onChange={(e) => setUsername(e.target.value)} />}</Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="ghost" onClick={() => setEdit(false)}>{t('Cancel')}</Button><Button variant="primary" onClick={save}>{t('Save')}</Button></div>
        </div>
      </Modal>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? t(detail.title) : undefined}>
        {detail && (() => { const r = detail.check(snap); return (<div className="reward"><PixelIcon name={detail.icon} size={72} /><p className="lead">{t(detail.description)}</p><span className={`chip ${r.done ? 'chip--done' : 'chip--locked'}`}>{r.done ? `${t('Unlocked')} +${detail.xp} XP` : `${t('Locked')} · ${t(r.label)}`}</span>{!r.done && <div style={{ width: '100%' }}><ProgressBar value={r.progress * 100} label={t(detail.title)} /></div>}</div>) })()}
      </Modal>
    </div>
  )
}
