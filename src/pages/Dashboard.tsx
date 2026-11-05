import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Bookmark, Bot, SquareTerminal, Flame, Lock, Map as MapIcon, Play, Sparkles, User } from 'lucide-react'
import { ACHIEVEMENTS, COURSES, QUESTS, lessonById, questById } from '../data/curriculum'
import { ButtonLink, Button, Card, CountUp, EmptyState, PixelIcon, ProgressBar, Ring, StatusChip } from '../components/ui'
import { ActivityCalendar, WeeklyChart } from '../components/Charts'
import { Character } from '../components/Character'
import { useI18n } from '../i18n'
import { courseProgress, dailyProgress, learningMinutes, nextLessonOf, overallProgress, questProgress, questStatus, snapshot, type GameState } from '../store/engine'
import { useAuth } from '../store/auth'
import { useGame } from '../store/game'
import { formatLong, greeting } from '../utils/dates'

/** The quest the learner should continue: in-progress first, then the first open quest. */
const pickContinue = (s: GameState) => {
  const playable = QUESTS.filter((q) => !q.soon)
  return playable.find((q) => questStatus(s, q) === 'in-progress') ?? playable.find((q) => questStatus(s, q) === 'available')
}

export default function Dashboard() {
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const { state, xp, level, start } = useGame()
  const nav = useNavigate()
  const snap = snapshot(state)
  const hours = Math.round((learningMinutes(state) / 60) * 10) / 10
  const completedQuests = QUESTS.filter((q) => ['completed', 'mastered'].includes(questStatus(state, q))).length
  const cont = pickContinue(state)
  const contLesson = cont ? lessonById(nextLessonOf(state, cont)) : undefined
  const daily = dailyProgress(state)
  const overall = overallProgress(state)
  const recent = Object.entries(state.completedLessons).filter(([id]) => lessonById(id)).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 5)
  const upcoming = QUESTS.filter((q) => questStatus(state, q) === 'locked').slice(0, 3)
  const recommended = QUESTS.filter((q) => !q.soon && ['available', 'in-progress'].includes(questStatus(state, q)) && q.id !== cont?.id).slice(0, 3)
  const ach = ACHIEVEMENTS.map((a) => ({ a, r: a.check(snap) })).sort((x, y) => Number(y.r.done) - Number(x.r.done) || y.r.progress - x.r.progress).slice(0, 4)
  const bookmark = state.bookmarks[0]

  const goContinue = () => { if (cont && contLesson) { start(cont.id); nav(`/app/lesson/${contLesson.id}`) } }

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <p className="muted">{formatLong(locale)}</p>
          <h1 className="page__title">{t(greeting())}{locale.startsWith('ar') ? '،' : ','} {user?.name}.</h1>
        </div>
        <Card pad={false} className="head-rank"><Character stage={level.level - 1} size={44} label /><div><strong>{t(level.rank)}</strong><span className="muted mono" style={{ fontSize: '0.78rem' }}>{t('Level')} {level.level}</span></div></Card>
      </header>

      <section aria-label={t('Statistics')} className="stats-row">
        {[
          { label: t('Total XP'), node: <CountUp value={xp} />, icon: 'star' },
          { label: t('Level'), node: <>{level.level}</>, icon: 'crown' },
          { label: t('Day streak'), node: <>{snap.streak}</>, icon: 'flame' },
          { label: t('Quests cleared'), node: <CountUp value={completedQuests} />, icon: 'flag' },
          { label: t('Learning hours'), node: <>{hours}</>, icon: 'calendar' },
          { label: t('Rank'), node: <span className="stat-sm">{t(level.rank)}</span>, icon: 'trophy' },
        ].map((s) => (
          <Card key={s.label} className="tile" pad={false}><PixelIcon name={s.icon} size={30} /><span className="tile__v mono">{s.node}</span><span className="tile__l">{s.label}</span></Card>
        ))}
      </section>

      <section aria-label={t('Tools')} className="tools-row">
        <Card hover accent="blue" className="tool"><PixelIcon name="brain" size={44} /><div><h3>{t('Forked AI')}</h3><p className="muted">{t('Ask questions, attach code or screenshots, and create images.')}</p></div><ButtonLink to="/app/assistant" variant="primary" size="sm" icon={<Bot size={16} />}>{t('Open AI Bot')}</ButtonLink></Card>
        <Card hover accent="green" className="tool"><PixelIcon name="code" size={44} /><div><h3>{t('Code Lab')}</h3><p className="muted">{t('Write and run Python or JavaScript, right in your browser.')}</p></div><ButtonLink to="/app/code" variant="primary" size="sm" icon={<SquareTerminal size={16} />}>{t('Open Code Lab')}</ButtonLink></Card>
      </section>

      <div className="dash-grid">
        <Card className="dash-continue" accent="blue">
          <span className="eyebrow">{t('Continue learning')}</span>
          {cont && contLesson ? (<>
            <h2>{t(contLesson.title)}</h2>
            <p className="muted">{t(cont.title)} · {t('Quest')} {String(cont.num).padStart(2, '0')}</p>
            <ProgressBar value={questProgress(state, cont).pct} label={t('Quest progress')} />
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="mono muted" style={{ fontSize: '0.82rem' }}>{questProgress(state, cont).done}/{questProgress(state, cont).total} {t('lessons')} · {contLesson.minutes} {t('min')}</span>
              <Button variant="primary" onClick={goContinue} icon={<Play size={16} />}>{questProgress(state, cont).done ? t('Continue') : t('Start')}</Button>
            </div>
          </>) : <p className="muted">{t('All current quests are cleared. More worlds are on the way.')}</p>}
        </Card>

        <Card className="dash-daily">
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="eyebrow">{t('Daily quest')}</span><span className="chip chip--warn">{t('+25 XP')}</span></div>
          <h3>{t(daily.def.title)}</h3>
          <p className="muted">{t(daily.def.text)}</p>
          <ProgressBar value={daily.pct} label={t('Daily quest progress')} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="mono" style={{ fontSize: '0.82rem' }}>{Math.min(daily.value, daily.def.target)}/{daily.def.target}</span>
            {daily.claimed ? <span className="chip chip--done">{t('Claimed')}</span> : <Button size="sm" onClick={goContinue} disabled={!cont}>{t('Go')}</Button>}
          </div>
        </Card>

        <Card className="dash-overview">
          <h3>{t('Learning overview')}</h3>
          <div className="rings">
            {[{ l: t('Overall'), v: overall.pct, c: 'var(--primary)' }, { l: t('Computer Science'), v: courseProgress(state, 'cs').pct, c: 'var(--gdg-green)' }, { l: 'Python', v: courseProgress(state, 'python').pct, c: 'var(--gdg-yellow)' }, { l: 'JavaScript', v: courseProgress(state, 'js').pct, c: 'var(--gdg-red)' }].map((r) => (
              <div key={r.l} className="ring-item"><Ring value={r.v} color={r.c} size={92} /><span>{r.l}</span></div>
            ))}
          </div>
        </Card>

        <Card className="dash-week"><h3>{t('Weekly activity')}</h3><WeeklyChart state={state} /></Card>
        <Card className="dash-cal"><h3>{t('Learning calendar')}</h3><ActivityCalendar state={state} compact /></Card>

        <Card className="dash-path">
          <h3>{t('Current learning path')}</h3>
          <ol className="path-list">
            {COURSES.map((c) => {
              const p = courseProgress(state, c.id)
              return (
                <li key={c.id}>
                  <PixelIcon name={c.icon} size={32} />
                  <div className="path-list__body"><Link to={`/app/course/${c.id}`}><strong>{t(c.title)}</strong></Link><ProgressBar value={p.pct} small label={t(c.title)} /></div>
                  <span className="mono muted" style={{ fontSize: '0.8rem' }}>{p.done}/{p.total}</span>
                </li>
              )
            })}
          </ol>
        </Card>

        <Card className="dash-recent">
          <h3>{t('Recently completed')}</h3>
          {recent.length === 0 ? <EmptyState icon="sprout" title={t('Nothing yet')} text={t('Finish your first lesson and it will appear here.')} action={<Button variant="primary" onClick={goContinue}>{t('Start a lesson')}</Button>} /> : (
            <ul className="list">
              {recent.map(([id, rec]) => { const l = lessonById(id)!; return (
                <li key={id}><Link to={`/app/lesson/${id}`} className="list__main"><strong>{t(l.title)}</strong><span className="muted">{t(questById(l.questId)?.title ?? '')}</span></Link>{rec.perfect && <span className="chip chip--done">{t('Perfect')}</span>}<span className="mono muted" style={{ fontSize: '0.75rem' }}>{new Date(rec.at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span></li>
              ) })}
            </ul>
          )}
        </Card>

        <Card className="dash-reco">
          <h3>{t('Recommended quests')}</h3>
          {recommended.length === 0 ? <p className="muted">{t('Clear more quests to unlock new recommendations.')}</p> : (
            <ul className="list">
              {recommended.map((q) => (
                <li key={q.id}><Link to="/app/quests" className="list__main"><strong>{t(q.title)}</strong><span className="muted">{t(q.difficulty)} · {q.minutes} {t('min')} · +{q.xp} XP</span></Link><StatusChip status={questStatus(state, q)} /></li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="dash-unlock">
          <h3>{t('Upcoming unlocks')}</h3>
          {upcoming.length === 0 ? <p className="muted">{t('Everything available is unlocked.')}</p> : (
            <ul className="list">
              {upcoming.map((q) => {
                const missing = q.prereqs.map((id) => questById(id)!).filter((p) => questStatus(state, p) !== 'completed' && questStatus(state, p) !== 'mastered')
                return <li key={q.id}><Lock size={16} className="muted" /><div className="list__main"><strong>{t(q.title)}</strong><span className="muted">{t('Needs')}: {missing.map((m) => t(m.title)).join(locale.startsWith('ar') ? '، ' : ', ')}</span></div></li>
              })}
            </ul>
          )}
        </Card>

        <Card className="dash-ach">
          <div className="row" style={{ justifyContent: 'space-between' }}><h3>{t('Achievement highlights')}</h3><Link to="/app/profile" className="mono" style={{ fontSize: '0.8rem' }}>{t('All badges')}</Link></div>
          <div className="ach-grid">
            {ach.map(({ a, r }) => (
              <div key={a.id} className={`ach ${r.done ? '' : 'ach--locked'}`}><PixelIcon name={a.icon} size={34} /><div><strong>{t(a.title)}</strong><span className="muted">{r.done ? t('Unlocked') : t(r.label)}</span>{!r.done && <ProgressBar value={r.progress * 100} small label={t(a.title)} />}</div></div>
            ))}
          </div>
        </Card>

        <Card className="dash-quick">
          <h3>{t('Quick actions')}</h3>
          <div className="quick">
            <ButtonLink to="/app/quests" icon={<MapIcon size={16} />}>{t('Open quest map')}</ButtonLink>
            <Button onClick={goContinue} icon={<ArrowRight size={16} />} disabled={!cont}>{t('Resume lesson')}</Button>
            <Button onClick={() => bookmark ? nav(`/app/lesson/${bookmark}`) : nav('/app/courses')} icon={<Bookmark size={16} />}>{bookmark ? t('Open bookmark') : t('Browse courses')}</Button>
            <ButtonLink to="/app/profile" icon={<User size={16} />}>{t('View profile')}</ButtonLink>
            <ButtonLink to="/app/settings" icon={<Sparkles size={16} />}>{t('Preferences')}</ButtonLink>
            <span className="chip chip--soft"><Flame size={12} /> {t('{n}-day streak', { n: snap.streak })}</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
