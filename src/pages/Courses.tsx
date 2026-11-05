import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Check, Clock, Lock, Play } from 'lucide-react'
import { BUILT_TOPICS, COURSES, courseById, lessonById, questsOfCourse } from '../data/curriculum'
import { Button, Card, PixelIcon, ProgressBar, Ring, StatusChip } from '../components/ui'
import { courseProgress, lessonDone, nextLessonOf, questProgress, questStatus, isPlayable } from '../store/engine'
import { useGame } from '../store/game'
import { useI18n } from '../i18n'

export function CourseList() {
  const { t } = useI18n()
  const { state } = useGame()
  return (
    <div className="page">
      <header className="page__head"><div><p className="muted">{t('Three paths, one quest map.')}</p><h1 className="page__title">{t('Courses')}</h1></div></header>
      <div className="grid grid--3">
        {COURSES.map((c) => {
          const p = courseProgress(state, c.id)
          const qs = questsOfCourse(c.id).filter((q) => !q.soon)
          const mins = qs.reduce((n, q) => n + q.minutes, 0)
          return (
            <Card key={c.id} accent={c.accent} hover className="path">
              <PixelIcon name={c.icon} size={60} />
              <h3>{t(c.title)}</h3>
              <p className="muted">{t(c.tagline)}</p>
              <ProgressBar value={p.pct} label={t(c.title)} />
              <div className="row" style={{ flexWrap: 'wrap' }}><span className="chip chip--soft">{p.done}/{p.total} {t('lessons')}</span><span className="chip chip--soft">~{Math.round(mins / 60)}{t('h')}</span></div>
              <Link to={`/app/course/${c.id}`} className="path__go">{p.done ? t('Open course') : t('View course')} <ArrowRight size={16} /></Link>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

export function CourseOverview() {
  const { t } = useI18n()
  const { id } = useParams()
  const nav = useNavigate()
  const { state, start } = useGame()
  if (!COURSES.some((c) => c.id === id)) return <Navigate to="/app/courses" replace />
  const c = courseById(id as never)
  const p = courseProgress(state, c.id)
  const qs = questsOfCourse(c.id)
  const live = qs.filter((q) => !q.soon)
  const mins = live.reduce((n, q) => n + q.minutes, 0)
  const next = live.find((q) => ['in-progress', 'available'].includes(questStatus(state, q)))
  const built = BUILT_TOPICS[c.id]

  return (
    <div className="page">
      <header className="course-hero">
        <PixelIcon name={c.icon} size={80} />
        <div>
          <span className="eyebrow mono">{t('Course')}</span>
          <h1 className="page__title">{t(c.title)}</h1>
          <p className="lead">{t(c.description)}</p>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 12 }}>
            <span className="chip chip--soft"><Clock size={12} /> ~{Math.round(mins / 60)}{t('h')} {t('of lessons live')}</span>
            <span className="chip chip--soft">{p.total} {t('lessons')}</span>
            <span className="chip chip--soft">{c.roadmap.length} {t('topics planned')}</span>
          </div>
        </div>
        <Card className="course-hero__prog"><Ring value={p.pct} /><div><strong>{t('Your progress')}</strong><span className="muted">{p.done} / {p.total} {t('lessons')}</span></div>
          {next ? <Button variant="primary" icon={<Play size={16} />} onClick={() => { start(next.id); nav(`/app/lesson/${nextLessonOf(state, next)}`) }}>{p.done ? t('Continue') : t('Start course')}</Button> : p.pct === 100 ? <span className="chip chip--done">{t('Course complete')}</span> : <span className="chip chip--locked">{t('Prerequisites needed')}</span>}
        </Card>
      </header>

      <div className="course-grid">
        <div className="course-main">
          <Card className="intro">
            <div className="row"><span className="avatar">Q</span><div><strong>{t(c.instructor.name)}</strong><span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>{t(c.instructor.role)}</span></div></div>
            <p>{t(c.instructor.intro)}</p>
          </Card>

          <h2 className="h-sm">{t('Curriculum')}</h2>
          <div className="curriculum">
            {qs.map((q) => {
              const st = questStatus(state, q); const pr = questProgress(state, q)
              return (
                <Card key={q.id} pad={false} className={`chapter chapter--${st}`}>
                  <div className="chapter__head">
                    <span className="mono chapter__n">{q.boss ? '★' : String(q.num).padStart(2, '0')}</span>
                    <div className="chapter__t"><strong>{t(q.title)}</strong><span className="muted">{t(q.description)}</span></div>
                    <StatusChip status={st} />
                  </div>
                  {q.lessonIds.length > 0 ? (
                    <ul className="chapter__lessons">
                      {q.lessonIds.map((lid) => { const l = lessonById(lid)!; const done = lessonDone(state, lid); const ok = isPlayable(st); return (
                        <li key={lid}>
                          <span className={`qd__dot ${done ? 'ok' : ''}`}>{done ? <Check size={12} strokeWidth={4} /> : ok ? null : <Lock size={11} />}</span>
                          {ok ? <Link to={`/app/lesson/${lid}`}>{t(l.title)}</Link> : <span className="muted">{t(l.title)}</span>}
                          <span className="mono muted" style={{ fontSize: '0.75rem' }}>{l.minutes} {t('min')}</span>
                        </li>
                      ) })}
                    </ul>
                  ) : <p className="muted chapter__soon">{t('Lessons for this chapter are on the roadmap.')}</p>}
                  {pr.total > 0 && <div style={{ padding: '0 20px 16px' }}><ProgressBar value={pr.pct} small label={t('Chapter progress')} /></div>}
                </Card>
              )
            })}
          </div>

          <h2 className="h-sm">{t('Full topic roadmap')}</h2>
          <p className="muted" style={{ marginBottom: 12 }}>{t('Highlighted topics have lessons today. The rest are planned for the course.')}</p>
          <div className="roadmap">{c.roadmap.map((tp, i) => <span key={tp} className={`topic ${built.includes(tp) ? 'topic--on' : ''}`}><span className="mono">{String(i + 1).padStart(2, '0')}</span>{t(tp)}</span>)}</div>
        </div>

        <aside className="course-side">
          <Card><h3>{t('You will learn to')}</h3><ul className="ticks">{c.objectives.map((o) => <li key={o}><Check size={14} strokeWidth={4} />{t(o)}</li>)}</ul></Card>
          <Card><h3>{t('Skills acquired')}</h3><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{c.skills.map((s) => <span key={s} className="chip chip--blue">{t(s)}</span>)}</div></Card>
          <Card><h3>{t('Prerequisites')}</h3><ul className="ticks">{c.prerequisites.map((o) => <li key={o}><Check size={14} strokeWidth={4} />{t(o)}</li>)}</ul></Card>
        </aside>
      </div>
    </div>
  )
}
