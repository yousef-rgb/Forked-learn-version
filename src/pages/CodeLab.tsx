import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, Copy, Download, Eraser, Play, RotateCcw, Square, Upload } from 'lucide-react'
import { Button, PixelIcon, useMedia } from '../components/ui'
import { CodeEditor } from '../lab/CodeEditor'
import { LabRunner, RUN_TIMEOUT_MS, type RuntimeStatus, type Stream } from '../lab/runner'
import { TEMPLATES, blank, type LabLang } from '../lab/templates'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import { useI18n } from '../i18n'

interface Chunk { id: number; stream: Stream; text: string }
const MAX_OUT = 200_000
const FILE: Record<LabLang, string> = { python: 'main.py', javascript: 'main.js' }
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } },
}

export default function CodeLab() {
  const { t } = useI18n()
  const { user } = useAuth()
  const { toast } = useToast()
  const nav = useNavigate()
  const loc = useLocation()
  const wide = useMedia('(min-width: 1000px)')
  const uid = (user?.email ?? 'guest').toLowerCase()
  const key = useCallback((suffix: string) => `forkedlab:${uid}:${suffix}`, [uid])

  const [lang, setLang] = useState<LabLang>(() => (store.get(`forkedlab:${uid}:lang`) === 'javascript' ? 'javascript' : 'python'))
  const [codes, setCodes] = useState<Record<LabLang, string>>(() => ({
    python: store.get(`forkedlab:${uid}:code:python`) ?? blank('python'),
    javascript: store.get(`forkedlab:${uid}:code:javascript`) ?? blank('javascript'),
  }))
  const [stdin, setStdin] = useState(() => store.get(`forkedlab:${uid}:stdin`) ?? '')
  const [out, setOut] = useState<Chunk[]>([])
  const [status, setStatus] = useState<RuntimeStatus>('idle')
  const [info, setInfo] = useState<{ ok: boolean; ms: number; timedOut: boolean; stopped: boolean } | null>(null)
  const [tab, setTab] = useState<'code' | 'out'>('code')
  const [side, setSide] = useState<'output' | 'input'>('output')
  const runner = useRef<LabRunner | null>(null)
  const idRef = useRef(0)
  const consoleRef = useRef<HTMLPreElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const code = codes[lang]
  const running = status === 'running'

  const handlers = useMemo(() => ({
    onStatus: setStatus,
    onOut: (stream: Stream, text: string) => setOut((o) => {
      const total = o.reduce((n, c) => n + c.text.length, 0)
      if (total > MAX_OUT) return o
      return [...o, { id: idRef.current++, stream, text: total + text.length > MAX_OUT ? text.slice(0, MAX_OUT - total) + '\n… output truncated' : text }]
    }),
  }), [])

  useEffect(() => { const r = new LabRunner(); runner.current = r; return () => { r.dispose(); runner.current = null } }, [])
  useEffect(() => { store.set(key('lang'), lang); if (lang === 'python') runner.current?.warm(handlers) }, [lang, key, handlers])
  useEffect(() => { const id = window.setTimeout(() => { store.set(key(`code:${lang}`), code) }, 400); return () => window.clearTimeout(id) }, [code, lang, key])
  useEffect(() => { store.set(key('stdin'), stdin) }, [stdin, key])
  useEffect(() => { const el = consoleRef.current; if (el) el.scrollTop = el.scrollHeight }, [out])

  // "Run" from an AI answer arrives as router state
  useEffect(() => {
    const s = loc.state as { code?: string; lang?: LabLang } | null
    if (s?.code && (s.lang === 'python' || s.lang === 'javascript')) {
      setLang(s.lang); setCodes((c) => ({ ...c, [s.lang as LabLang]: s.code as string })); nav(loc.pathname, { replace: true, state: null })
    }
  }, [loc.state, loc.pathname, nav])

  const setCode = useCallback((v: string) => setCodes((c) => ({ ...c, [lang]: v })), [lang])

  const run = useCallback(async () => {
    const r = runner.current
    if (!r || running) return
    setOut([]); setInfo(null); setSide('output'); if (!wide) setTab('out')
    const res = await r.run(lang, code, stdin, handlers)
    setInfo(res)
  }, [code, handlers, lang, running, stdin, wide])
  const stop = () => runner.current?.stop()

  const copy = async (v: string, msg: string) => { try { await navigator.clipboard.writeText(v); toast({ kind: 'success', title: t(msg) }) } catch { toast({ kind: 'error', title: t('Could not copy') }) } }
  const download = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' })); a.download = FILE[lang]
    document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(a.href), 1500)
  }
  const upload = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 500 * 1024) { toast({ kind: 'error', title: t('File too large'), body: t('Code Lab opens files up to 500 KB.') }); return }
    const ext = f.name.split('.').pop()?.toLowerCase()
    const l: LabLang = ext === 'py' ? 'python' : ext === 'js' || ext === 'mjs' ? 'javascript' : lang
    setLang(l); setCodes((c) => ({ ...c, [l]: '' })); window.setTimeout(() => void f.text().then((txt) => setCodes((c) => ({ ...c, [l]: txt }))), 0)
    if (fileRef.current) fileRef.current.value = ''
  }
  const outText = out.map((c) => c.text).join('')
  const askAi = () => {
    const err = out.filter((c) => c.stream === 'stderr').map((c) => c.text).join('').trim()
    const fence = '```'
    const prompt = `${err ? 'My code fails with an error. Explain why and show the fix.' : 'Review my code and suggest improvements.'}\n\n${fence}${lang}\n${code}\n${fence}${err ? `\n\nError:\n${fence}\n${err.slice(0, 2000)}\n${fence}` : ''}`
    nav('/app/assistant', { state: { prefill: prompt } })
  }

  const runtime = status === 'loading' ? t('Loading Python…') : status === 'running' ? t('Running…') : status === 'failed' ? t('Runtime unavailable') : lang === 'python' ? (status === 'ready' ? t('Python ready') : t('Python loads on first run')) : t('JavaScript ready')
  const verdict = info ? (info.timedOut ? t('Stopped: over {s} seconds', { s: RUN_TIMEOUT_MS / 1000 }) : info.stopped ? t('Stopped') : info.ok ? t('Finished in {ms} ms', { ms: info.ms }) : t('Finished with an error')) : null

  const editorCard = (
    <section className="lab__card pcard" aria-label={t('Code editor')}>
      <div className="lab__bar">
        <span className="chip chip--soft mono" dir="ltr">{FILE[lang]}</span>
        <span className="lab__spacer" />
        <button type="button" className="icon-btn lab__ib" onClick={() => void copy(code, 'Code copied')} aria-label={t('Copy code')} title={t('Copy code')}><Copy size={16} /></button>
        <button type="button" className="icon-btn lab__ib" onClick={download} aria-label={t('Download file')} title={t('Download file')}><Download size={16} /></button>
        <button type="button" className="icon-btn lab__ib" onClick={() => fileRef.current?.click()} aria-label={t('Open a file')} title={t('Open a file')}><Upload size={16} /></button>
        <button type="button" className="icon-btn lab__ib" onClick={() => setCode(blank(lang))} aria-label={t('Reset code')} title={t('Reset code')}><RotateCcw size={16} /></button>
        <input ref={fileRef} type="file" hidden accept=".py,.js,.mjs,.txt" onChange={(e) => void upload(e.target.files?.[0])} />
      </div>
      <CodeEditor value={code} lang={lang} onChange={setCode} onRun={() => void run()} />
    </section>
  )

  const outputCard = (
    <section className="lab__card pcard" aria-label={t('Output')}>
      <div className="lab__bar">
        <div className="seg seg--sm" role="tablist" aria-label={t('Output')}>
          <button type="button" role="tab" aria-selected={side === 'output'} className={side === 'output' ? 'is-on' : ''} onClick={() => setSide('output')}>{t('Output')}</button>
          <button type="button" role="tab" aria-selected={side === 'input'} className={side === 'input' ? 'is-on' : ''} onClick={() => setSide('input')}>{t('Input')}</button>
        </div>
        <span className="lab__spacer" />
        {verdict && <span className={`chip ${info?.ok ? 'chip--done' : 'chip--warn'}`}>{verdict}</span>}
        <button type="button" className="icon-btn lab__ib" onClick={() => void copy(outText, 'Output copied')} aria-label={t('Copy output')} title={t('Copy output')} disabled={!outText}><Copy size={16} /></button>
        <button type="button" className="icon-btn lab__ib" onClick={() => { setOut([]); setInfo(null) }} aria-label={t('Clear output')} title={t('Clear output')} disabled={!out.length}><Eraser size={16} /></button>
      </div>
      {side === 'output' ? (
        <pre className="lab__console" ref={consoleRef} dir="ltr" role="log" aria-live="polite" tabIndex={0}>
          {out.length === 0 && !running && <span className="lab__hint">{t('Press Run (Ctrl/⌘ + Enter) to see the output here.')}</span>}
          {out.map((c) => <span key={c.id} className={c.stream === 'stderr' ? 'is-err' : ''}>{c.text}</span>)}
          {running && <span className="caret" aria-hidden="true" />}
        </pre>
      ) : (
        <div className="lab__inwrap">
          <label htmlFor="lab-stdin" className="field-hint">{t('One value per line. Your input() calls read them in order.')}</label>
          <textarea id="lab-stdin" className="lab__stdin input" dir="ltr" value={stdin} onChange={(e) => setStdin(e.target.value)} spellCheck={false} placeholder={'Nour\n12'} />
        </div>
      )}
      {out.some((c) => c.stream === 'stderr') && !running && (
        <div className="lab__foot"><Button size="sm" icon={<Bot size={14} />} onClick={askAi}>{t('Explain this error with Forked AI')}</Button></div>
      )}
    </section>
  )

  return (
    <div className="toolpage lab">
      <header className="lab__head">
        <PixelIcon name="code" size={34} />
        <div className="lab__titles"><h1>{t('Code Lab')}</h1><span className="muted">{t('Write and run Python or JavaScript, right in your browser.')}</span></div>
        <div className="seg" role="radiogroup" aria-label={t('Language')}>
          {(['python', 'javascript'] as LabLang[]).map((l) => <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? 'is-on' : ''} onClick={() => !running && setLang(l)} disabled={running && lang !== l}>{l === 'python' ? 'Python' : 'JavaScript'}</button>)}
        </div>
        <select className="input lab__tpl" aria-label={t('Examples')} value="" onChange={(e) => { const tp = TEMPLATES.find((x) => x.id === e.target.value); if (tp) setCode(tp.code[lang]) }}>
          <option value="">{t('Examples…')}</option>
          {TEMPLATES.map((x) => <option key={x.id} value={x.id}>{t(x.title)}</option>)}
        </select>
        <span className="chip chip--soft lab__status" role="status"><i className={`lab__dot lab__dot--${status}`} />{runtime}</span>
        {running
          ? <Button variant="ink" icon={<Square size={14} fill="currentColor" />} onClick={stop}>{t('Stop')}</Button>
          : <Button variant="primary" icon={<Play size={16} fill="currentColor" />} onClick={() => void run()} disabled={status === 'loading'}>{t('Run')}</Button>}
      </header>
      {!wide && (
        <div className="seg lab__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'is-on' : ''} onClick={() => setTab('code')}>{t('Code')}</button>
          <button type="button" role="tab" aria-selected={tab === 'out'} className={tab === 'out' ? 'is-on' : ''} onClick={() => setTab('out')}>{t('Output')}{out.length ? ' •' : ''}</button>
        </div>
      )}
      <div className="lab__grid">
        {(wide || tab === 'code') && editorCard}
        {(wide || tab === 'out') && outputCard}
      </div>
    </div>
  )
}
