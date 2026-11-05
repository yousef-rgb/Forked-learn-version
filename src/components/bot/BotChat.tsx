import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowDown, Check, Copy, FileCode2, Image as ImageIcon, ImagePlus, Paperclip, RefreshCw, Send, SlidersHorizontal, Sparkles, Square, Trash2, Wand2, X } from 'lucide-react'
import { Button, PixelIcon } from '../ui'
import { Markdown } from './Markdown'
import { ImageCard } from './ImageCard'
import { ThinkingLoader } from './ThinkingLoader'
import { useAuth } from '../../store/auth'
import { useToast } from '../../store/toast'
import { useBot, type FileChip, type Mode, type Msg, type SendOpts } from '../../store/useBot'
import { useI18n } from '../../i18n'
import { isChatConfigured, isImageConfigured } from '../../lib/env'
import { LIMITS, PRESETS, QUALITY_LABELS, validateDimensions, type Quality, type Shape } from '../../services/imageGen'
import { MAX_CHAT_FILES } from '../../services/botApi'
import { ACCEPT_ATTR, FileError, humanSize, languageLabel, prepareFile, type PreparedFile } from '../../services/fileReader'

const SUGGESTIONS = [
  'Explain how neural networks learn',
  'Generate a pixel-art castle at sunset',
  'Help me debug my Python loop',
  'Review this code and suggest improvements',
]

function Chip({ c, onRemove }: { c: FileChip | PreparedFile; onRemove?: () => void }) {
  const { t } = useI18n()
  const code = c.kind === 'code'
  const meta = code ? `${languageLabel(c.language ?? 'text')}${c.lines ? ` · ${c.lines} ${t('lines')}` : ''}` : humanSize(c.size)
  return (
    <span className={`fchip ${code ? 'fchip--code' : 'fchip--img'}`} title={`${c.name} · ${humanSize(c.size)}`}>
      <span className="fchip__ic" aria-hidden="true">{code ? <FileCode2 size={15} /> : <ImageIcon size={15} />}</span>
      <span className="fchip__t"><b dir="ltr">{c.name}</b><small>{meta}</small></span>
      {onRemove && <button type="button" className="fchip__x" onClick={onRemove} aria-label={t('Remove {name}', { name: c.name })}><X size={12} /></button>}
    </span>
  )
}

interface ViewProps {
  m: Msg; isLast: boolean; busy: boolean; locale: string
  onCancel: (id: string) => void; onRegenerate: (id: string) => void; onEdit: (id: string) => void; onDelete: (id: string) => void
  onCopy: (t: string) => void; onRetry: () => void; onStop: () => void
}

const MsgView = memo(function MsgView({ m, isLast, busy, locale, onCancel, onRegenerate, onEdit, onDelete, onCopy, onRetry, onStop }: ViewProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const time = new Date(m.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  if (m.role === 'user') {
    return (
      <div className="bmsg bmsg--user">
        <div className="bmsg__bubble">
          {m.files && m.files.length > 0 && (
            <div className="bmsg__files">
              {m.attachments && m.attachments.length > 0
                ? m.attachments.map((a) => <img key={a.id} src={a.url} alt={a.name} />)
                : null}
              {m.files.filter((f) => f.kind === 'code' || !m.attachments?.length).map((f) => <Chip key={f.id} c={f} />)}
            </div>
          )}
          {m.text ? <p dir="auto" className="bmsg__plain">{m.text}</p> : null}
        </div>
      </div>
    )
  }

  const thinking = !!m.streaming && !(m.text ?? '').trim() && !m.gen
  return (
    <div className="bmsg bmsg--ai">
      <span className="bmsg__av" aria-hidden="true"><PixelIcon name="brain" size={24} /></span>
      <div className={`bmsg__bubble ${m.error ? 'is-error' : ''} ${m.streaming ? 'is-streaming' : ''}`} aria-busy={!!m.streaming}>
        <div className="bmsg__top"><span>▪ FORKED AI</span><time className="mono">{time}</time></div>
        <div className="bmsg__body">
          {m.gen ? (
            <ImageCard gen={m.gen} at={m.at} onCancel={() => onCancel(m.id)} onRegenerate={() => onRegenerate(m.id)} onEdit={() => onEdit(m.id)} onDelete={() => onDelete(m.id)} onCopy={onCopy} />
          ) : thinking ? (
            <ThinkingLoader onStop={onStop} />
          ) : m.error ? (
            <p dir="auto" className="bmsg__plain">{m.text}</p>
          ) : (
            <Markdown text={m.text ?? ''} caret={!!m.streaming} />
          )}
          {m.stopped && !m.streaming && <p className="bmsg__note" role="status">{m.failNote ? `${t('Connection lost')}: ${t(m.failNote)}` : t('Stopped')}</p>}
        </div>
        {!m.gen && !m.streaming && (m.text ?? '').trim() && (
          <div className="bmsg__foot">
            {!m.error && <button type="button" className="bmsg__act" onClick={() => { onCopy(m.text ?? ''); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('Copied') : t('Copy')}</button>}
            {isLast && !busy && <button type="button" className="bmsg__act" onClick={onRetry}><RefreshCw size={14} /> {m.error ? t('Try again') : t('Regenerate')}</button>}
          </div>
        )}
        {m.streaming && !thinking && <div className="bmsg__foot"><button type="button" className="bmsg__act" onClick={onStop}><Square size={11} fill="currentColor" /> {t('Stop')}</button></div>}
      </div>
    </div>
  )
})

export function BotChat({ height = '100%' }: { height?: number | string }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const { t, locale } = useI18n()
  const nav = useNavigate()
  const loc = useLocation()
  const notify = useCallback((title: string, body?: string) => toast({ kind: 'error', title: t(title), body: body ? t(body) : undefined }), [toast, t])
  const bot = useBot((user?.email ?? 'guest').toLowerCase(), notify)

  const [text, setText] = useState('')
  const [picked, setPicked] = useState<PreparedFile[]>([])
  const [reading, setReading] = useState(0)
  const [mode, setMode] = useState<Mode>('auto')
  const [showSettings, setShowSettings] = useState(false)
  const [shape, setShape] = useState<Shape>('square')
  const [custom, setCustom] = useState({ w: 1024, h: 1024 })
  const [enhance, setEnhance] = useState(false)
  const [quality, setQuality] = useState<Quality>('balanced')
  const [choice, setChoice] = useState<'original' | 'enhanced'>('enhanced')
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const log = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const pickedRef = useRef<PreparedFile[]>([])
  const dragDepth = useRef(0)
  useEffect(() => { pickedRef.current = picked }, [picked])

  const dims = shape === 'custom' ? custom : PRESETS[shape]
  const dimsW = dims.w, dimsH = dims.h
  const dimError = shape === 'custom' ? validateDimensions(custom.w, custom.h) : null
  const target = bot.editTarget ? bot.msgs.find((m) => m.id === bot.editTarget) : undefined

  // keep the log pinned to the bottom unless the user scrolled up
  useEffect(() => { const el = log.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [bot.msgs, bot.pending])
  useEffect(() => { if (bot.pending) { setDraft(bot.pending.enhanced); setChoice('enhanced') } }, [bot.pending])
  useEffect(() => () => { pickedRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl)) }, [])

  // "Ask Forked AI" from the Code Lab (or any page) arrives as router state
  useEffect(() => {
    const prefill = (loc.state as { prefill?: string } | null)?.prefill
    if (prefill) { setText(prefill); setMode('chat'); nav(loc.pathname, { replace: true, state: null }) }
  }, [loc.state, loc.pathname, nav])

  const addFiles = useCallback(async (input: FileList | File[] | null) => {
    if (!input) return
    const list = Array.from(input)
    for (const f of list) {
      if (pickedRef.current.length >= MAX_CHAT_FILES) { notify(t('Too many files'), t('You can attach up to {n} files.', { n: MAX_CHAT_FILES })); break }
      setReading((n) => n + 1)
      try {
        const p = await prepareFile(f)
        pickedRef.current = [...pickedRef.current, p]
        setPicked(pickedRef.current)
        if (p.warning === 'secrets') toast({ kind: 'info', title: t('This file may contain secrets'), body: t('Passwords or API keys in it will be sent to the AI. Remove them first if you are unsure.') })
      } catch (e) {
        if (e instanceof FileError) notify(t('Could not read the file'), t(e.key, e.vars))
        else notify(t('Could not read the file'), f.name)
      } finally { setReading((n) => n - 1) }
    }
    if (fileRef.current) fileRef.current.value = ''
  }, [notify, t, toast])
  const removePicked = (id: string) => {
    const f = pickedRef.current.find((x) => x.id === id)
    if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl)
    pickedRef.current = pickedRef.current.filter((x) => x.id !== id)
    setPicked(pickedRef.current)
  }

  const submit = async () => {
    if (bot.chatBusy || reading > 0) return
    const opts: SendOpts = { mode, width: dimsW, height: dimsH, enhance, quality }
    const ok = await bot.send(text, picked, opts)
    if (ok) {
      pickedRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
      pickedRef.current = []; setPicked([]); setText(''); stick.current = true; setAtBottom(true)
    }
  }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() } }
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files)
    if (files.length) { e.preventDefault(); void addFiles(files) }
  }
  const copy = useCallback(async (v: string) => { try { await navigator.clipboard.writeText(v); toast({ kind: 'success', title: t('Copied') }) } catch { notify('Could not copy') } }, [notify, t, toast])
  const clearAll = async () => { if (window.confirm(t('Clear this conversation? Generated images in the chat will be removed.'))) await bot.clear() }
  const scrollDown = () => { const el = log.current; if (el) { stick.current = true; el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) } }

  const onDragEnter = (e: React.DragEvent) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); dragDepth.current++; setDragging(true) }
  const onDragLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) }
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); void addFiles(e.dataTransfer.files) }

  const { cancel, regenerate, setEditTarget, removeMessage, retryLast, cancelChat } = bot
  const onEdit = useCallback((id: string) => { setEditTarget(id); setMode('image') }, [setEditTarget])
  const hint = useMemo(() => (mode === 'image' ? t('Describe the image to create or change…') : mode === 'chat' ? t('Ask anything…') : t('Ask anything, or describe an image to create…')), [mode, t])
  const lastId = bot.msgs.length ? bot.msgs[bot.msgs.length - 1].id : ''
  const enhancing = bot.enhancing

  if (!isChatConfigured) {
    return (
      <section className="bot pcard" style={{ minHeight: 220 }} aria-label={t('Forked AI assistant')}>
        <div className="bot__empty"><PixelIcon name="brain" size={64} /><h3>{t('AI Bot is not connected yet')}</h3>
          <p className="muted">{t('Set')} <code>VITE_API_BASE_URL</code> {t('in your environment (Vercel → Settings → Environment Variables, or a local .env) and rebuild.')}</p></div>
      </section>
    )
  }

  const sendDisabled = (!text.trim() && picked.length === 0) || reading > 0 || (shape === 'custom' && !!dimError && mode !== 'chat') || !!bot.pending || enhancing

  return (
    <section className={`bot pcard ${dragging ? 'is-drag' : ''}`} style={{ height }} aria-label={t('Forked AI assistant')}
      onDragEnter={onDragEnter} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="bot__head">
        <span className="bot__logo" aria-hidden="true"><PixelIcon name="brain" size={30} /></span>
        <div className="bot__title"><strong>Forked AI</strong><span className="muted mono">{isImageConfigured ? t('chat · images · code files') : t('chat · code files')}</span></div>
        <span className={`chip ${isImageConfigured ? 'chip--done' : 'chip--warn'}`}>{isImageConfigured ? t('Online') : t('Images off')}</span>
        <button type="button" className="icon-btn" onClick={() => void clearAll()} aria-label={t('Clear conversation')} title={t('Clear conversation')} disabled={bot.msgs.length === 0}><Trash2 size={17} /></button>
      </header>

      <div className="bot__logwrap">
        <div className="bot__log" ref={log} role="log" aria-live="polite" aria-relevant="additions"
          onScroll={(e) => { const el = e.currentTarget; const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80; stick.current = near; setAtBottom(near) }}>
          <div className="bot__thread">
            {bot.msgs.length === 0 && (
              <div className="bot__empty">
                <PixelIcon name="mascot" size={92} />
                <h3>{t('What are we building today?')}</h3>
                <p className="muted">{t('Ask a question, attach code or screenshots, or describe an image and I will create it.')}</p>
                <div className="bot__sugs">{SUGGESTIONS.map((s) => <button key={s} type="button" className="btn btn--ghost btn--sm" onClick={() => setText(t(s))}>{t(s)}</button>)}</div>
              </div>
            )}
            {bot.msgs.map((m) => (
              <MsgView key={m.id} m={m} isLast={m.id === lastId} busy={bot.chatBusy} locale={locale}
                onCancel={cancel} onRegenerate={regenerate} onEdit={onEdit} onDelete={removeMessage} onCopy={copy} onRetry={retryLast} onStop={cancelChat} />
            ))}
            {enhancing && (
              <div className="bmsg bmsg--ai" role="status">
                <span className="bmsg__av" aria-hidden="true"><PixelIcon name="brain" size={24} /></span>
                <div className="bmsg__bubble"><div className="bmsg__top"><span>▪ FORKED AI</span></div><div className="bmsg__body"><ThinkingLoader label="Enhancing your prompt…" /></div></div>
              </div>
            )}
          </div>
        </div>
        {!atBottom && <button type="button" className="bot__down icon-btn" onClick={scrollDown} aria-label={t('Jump to latest')}><ArrowDown size={18} /></button>}
        {dragging && <div className="bot__drop" aria-hidden="true"><FileCode2 size={34} /><strong>{t('Drop files to attach')}</strong><span>{t('Code, text, notebooks and images')}</span></div>}
      </div>

      {bot.pending && (
        <div className="bot__review" role="group" aria-label={t('Choose the prompt to use')}>
          <div className="row" style={{ justifyContent: 'space-between' }}><strong><Sparkles size={14} /> {t('Review prompt')}</strong><button type="button" className="icon-btn" onClick={bot.cancelPending} aria-label={t('Cancel')}><X size={16} /></button></div>
          <div className="seg" role="radiogroup" aria-label={t('Prompt version')}>
            {(['original', 'enhanced'] as const).map((c) => <button key={c} type="button" role="radio" aria-checked={choice === c} className={choice === c ? 'is-on' : ''} onClick={() => setChoice(c)}>{c === 'original' ? t('Original') : t('Enhanced')}</button>)}
          </div>
          {choice === 'original'
            ? <p className="bot__orig" dir="auto">{bot.pending.original}</p>
            : <textarea className="input" dir="auto" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('Enhanced prompt (editable)')} maxLength={1500} />}
          <Button variant="primary" size="sm" icon={<Wand2 size={14} />} onClick={() => bot.confirmPending(choice, draft)} disabled={choice === 'enhanced' && !draft.trim()}>{t('Generate')}</Button>
        </div>
      )}

      <div className="bot__composer">
        {target?.gen?.url && <div className="bot__target"><img src={target.gen.url} alt="" /><span>{t('Editing this image. Describe the change.')}</span><button type="button" className="icon-btn" onClick={() => bot.setEditTarget(null)} aria-label={t('Stop editing this image')}><X size={15} /></button></div>}
        {(picked.length > 0 || reading > 0) && (
          <ul className="bot__picked" aria-label={t('Attached files')}>
            {picked.map((p) => (
              <li key={p.id} className={p.kind === 'image' ? 'is-img' : ''}>
                {p.kind === 'image' && p.previewUrl
                  ? <><img src={p.previewUrl} alt={p.name} /><button type="button" className="bot__px" onClick={() => removePicked(p.id)} aria-label={t('Remove {name}', { name: p.name })}><X size={12} /></button></>
                  : <Chip c={p} onRemove={() => removePicked(p.id)} />}
              </li>
            ))}
            {reading > 0 && <li className="bot__reading" role="status"><span className="spinner" aria-hidden="true" /> {t('Reading files…')}</li>}
          </ul>
        )}
        {showSettings && (
          <div className="bot__settings">
            <div className="field"><label>{t('Size')}</label>
              <div className="seg" role="radiogroup" aria-label={t('Image shape')}>
                {(['square', 'portrait', 'landscape', 'custom'] as Shape[]).map((s) => <button key={s} type="button" role="radio" aria-checked={shape === s} className={shape === s ? 'is-on' : ''} onClick={() => setShape(s)}>{s === 'custom' ? t('Custom') : t(PRESETS[s].label)}</button>)}
              </div>
            </div>
            {shape === 'custom' ? (
              <div className="bot__dims">
                <div className="field"><label htmlFor="bw">{t('Width')}</label><input id="bw" className="input" type="number" inputMode="numeric" min={LIMITS.minSide} max={LIMITS.maxSide} value={custom.w} onChange={(e) => setCustom((c) => ({ ...c, w: Number(e.target.value) }))} aria-invalid={!!dimError} /></div>
                <span aria-hidden="true">×</span>
                <div className="field"><label htmlFor="bh">{t('Height')}</label><input id="bh" className="input" type="number" inputMode="numeric" min={LIMITS.minSide} max={LIMITS.maxSide} value={custom.h} onChange={(e) => setCustom((c) => ({ ...c, h: Number(e.target.value) }))} aria-invalid={!!dimError} /></div>
                {dimError ? <span className="field-error" role="alert">{t(dimError)}</span> : <span className="field-hint">{t('{min}–{max} px per side', { min: LIMITS.minSide, max: LIMITS.maxSide })}</span>}
              </div>
            ) : <span className="field-hint mono">{dimsW}×{dimsH}px</span>}
            <div className="field"><label>{t('Quality')}</label>
              <div className="seg" role="radiogroup" aria-label={t('Image quality')}>
                {(['fast', 'balanced', 'max'] as Quality[]).map((q) => <button key={q} type="button" role="radio" aria-checked={quality === q} className={quality === q ? 'is-on' : ''} onClick={() => setQuality(q)}>{t(QUALITY_LABELS[q])}</button>)}
              </div>
            </div>
            <label className="check"><input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} /> {t('Enhance my prompt before generating')}</label>
            <span className="field-hint">{t('Up to {n} reference images (PNG, JPEG, WebP, GIF, AVIF… up to {mb} MB each; resized automatically).', { n: LIMITS.maxRefs, mb: LIMITS.maxFileBytes / 1024 / 1024 })}</span>
          </div>
        )}
        <div className="bot__bar">
          <div className="seg seg--sm" role="radiogroup" aria-label={t('Mode')}>
            {(['auto', 'chat', 'image'] as Mode[]).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'is-on' : ''} onClick={() => setMode(m)} disabled={m === 'image' && !isImageConfigured} title={m === 'image' && !isImageConfigured ? t('Set VITE_IMAGE_WORKER_URL to enable images') : undefined}>{m === 'auto' ? t('Auto') : m === 'chat' ? t('Chat') : t('Image')}</button>)}
          </div>
          <span className="bot__spacer" />
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label={t('Attach code files or images')} title={t('Attach code files or images')} disabled={picked.length >= MAX_CHAT_FILES}><Paperclip size={18} /></button>
          <button type="button" className={`icon-btn ${showSettings ? 'is-on' : ''}`} onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings} aria-label={t('Image settings')} title={t('Image settings')}><SlidersHorizontal size={18} /></button>
          <input ref={fileRef} type="file" multiple hidden accept={ACCEPT_ATTR} onChange={(e) => void addFiles(e.target.files)} />
        </div>
        <div className="bot__input">
          <textarea className="input" dir="auto" rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste} placeholder={hint} aria-label={t('Message')} maxLength={8000} />
          {bot.chatBusy
            ? <Button variant="ink" onClick={cancelChat} icon={<Square size={14} fill="currentColor" />} aria-label={t('Stop')}>{t('Stop')}</Button>
            : <Button variant="primary" onClick={() => void submit()} disabled={sendDisabled} icon={mode === 'image' ? <ImagePlus size={17} /> : <Send size={17} />} aria-label={t('Send')}>{mode === 'image' ? t('Create') : t('Send')}</Button>}
        </div>
      </div>
    </section>
  )
}
