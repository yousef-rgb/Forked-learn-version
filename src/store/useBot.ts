import { useCallback, useEffect, useRef, useState } from 'react'
import { BotError, MAX_CHAT_FILES, clearChat, enhanceImagePrompt, getSessionId, resetSessionId, streamChat } from '../services/botApi'
import { buildMessage, type PreparedFile } from '../services/fileReader'
import { LIMITS, fileToDataUrl, generateImage, urlToDataUrl, validateDimensions, validateImageFile, type Quality } from '../services/imageGen'
import { isImageConfigured } from '../lib/env'
import { detectIntent, type Intent } from '../services/intent'

export type Mode = 'auto' | 'chat' | 'image'
export interface Gen {
  status: 'loading' | 'done' | 'error' | 'cancelled'
  kind: 'generate' | 'edit'
  prompt: string; enhanced?: string
  width: number; height: number; quality: Quality
  url?: string; temporary?: boolean; mime?: string; error?: string
  /** In-memory reference images (data URLs) so Regenerate can repeat an edit. Never persisted. */
  refs: string[]
}
export interface Attachment { id: string; name: string; url: string; image: boolean }
export interface FileChip { id: string; name: string; size: number; kind: 'image' | 'code'; language?: string; lines?: number }
export interface Msg {
  id: string; role: 'user' | 'ai'; at: number; text?: string; error?: boolean
  /** In-memory image previews (blob URLs, never persisted). */
  attachments?: Attachment[]
  /** Persisted file chips (names only, never the content). */
  files?: FileChip[]
  gen?: Gen
  /** The answer is still arriving (live stream / progressive reveal). */
  streaming?: boolean
  /** The user pressed Stop, or the connection dropped, after part of the answer arrived. */
  stopped?: boolean
  /** Short note shown under a partial answer that ended with an error. */
  failNote?: string
}
export interface SendOpts { mode: Mode; width: number; height: number; enhance: boolean; quality: Quality }
export interface Pending { original: string; enhanced: string; intent: 'generate' | 'edit'; files: File[]; opts: SendOpts }

const uid = () => crypto.randomUUID()
const KEEP = 60
const storeKey = (userId: string) => `forkedai:bot:${userId}`

/** Only text and permanent (https) images survive a reload. Blob URLs and base64 are never written to storage. */
function load(userId: string): Msg[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(userId)) ?? '[]') as Msg[]
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m.id === 'string').map((m) => (m.streaming ? { ...m, streaming: false, stopped: true } : m)) : []
  } catch { return [] }
}
function save(userId: string, msgs: Msg[]) {
  const out = msgs.slice(-KEEP).flatMap((m): Msg[] => {
    if (m.gen) {
      if (m.gen.status !== 'done' || !m.gen.url || m.gen.temporary) return []
      return [{ ...m, gen: { ...m.gen, refs: [] }, attachments: undefined }]
    }
    if (m.role === 'ai' && m.streaming && !(m.text ?? '').trim()) return []
    return [{ ...m, attachments: undefined, streaming: false, stopped: m.stopped || m.streaming || undefined }]
  })
  try { localStorage.setItem(storeKey(userId), JSON.stringify(out)) } catch { /* quota / private mode */ }
}


/** Releases queued text a few characters per animation frame (adaptive: big bursts catch up fast, slow streams stay immediate). */
function createDrain(apply: (id: string, chunk: string) => void, onIdle: (id: string) => void) {
  let id = '', queue = '', raf = 0, ended = false
  const tick = () => {
    raf = 0
    if (!queue) { if (ended) { ended = false; onIdle(id) } return }
    let n = Math.max(2, Math.ceil(queue.length / 28))
    const c = queue.charCodeAt(Math.min(n, queue.length) - 1)
    if (c >= 0xd800 && c <= 0xdbff) n++ // never split an emoji / surrogate pair
    apply(id, queue.slice(0, n)); queue = queue.slice(n)
    raf = requestAnimationFrame(tick)
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick) }
  const cancel = () => { if (raf) cancelAnimationFrame(raf); raf = 0; queue = ''; ended = false }
  return {
    start(newId: string) { cancel(); id = newId },
    push(c: string) { queue += c; if (document.hidden) { apply(id, queue); queue = '' } else kick() },
    end() { ended = true; if (document.hidden) { apply(id, queue); queue = ''; ended = false; onIdle(id) } else kick() },
    cancel,
    pending: () => queue.length,
  }
}

export function useBot(userId: string, notify: (title: string, body?: string) => void) {
  const [msgs, setMsgs] = useState<Msg[]>(() => load(userId))
  const [chatBusy, setChatBusy] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [editTarget, setEditTarget] = useState<string | null>(null)
  const sessionRef = useRef(getSessionId(userId))
  const genCtrls = useRef(new Map<string, AbortController>())
  const chatCtrl = useRef<AbortController | null>(null)
  const lastSend = useRef(0)
  const pendingTarget = useRef<string | undefined>(undefined)
  const msgsRef = useRef(msgs)
  useEffect(() => { msgsRef.current = msgs }, [msgs])

  useEffect(() => { save(userId, msgs) }, [userId, msgs])
  useEffect(() => {
    const ctrls = genCtrls.current
    const d = drain
    return () => { ctrls.forEach((c) => c.abort()); chatCtrl.current?.abort(); d.current?.cancel() }
  }, [])

  const push = useCallback((m: Msg) => setMsgs((l) => [...l, m]), [])
  const patchGen = useCallback((id: string, g: Partial<Gen>) => setMsgs((l) => l.map((m) => (m.id === id && m.gen ? { ...m, gen: { ...m.gen, ...g } } : m))), [])
  const generating = msgs.some((m) => m.gen?.status === 'loading')

  const runGen = useCallback(async (id: string, g: Gen) => {
    const ctrl = genCtrls.current.get(id) ?? new AbortController(); genCtrls.current.set(id, ctrl)
    try {
      const r = await generateImage({ prompt: g.enhanced ?? g.prompt, width: g.width, height: g.height, references: g.refs, sessionId: sessionRef.current, signal: ctrl.signal, quality: g.quality })
      patchGen(id, { status: 'done', url: r.url, temporary: r.temporary, mime: r.mime, error: undefined })
    } catch (e) {
      const err = e instanceof BotError ? e : new BotError('server', 'Something went wrong while generating the image.')
      patchGen(id, err.code === 'aborted' ? { status: 'cancelled' } : { status: 'error', error: err.message })
    } finally { genCtrls.current.delete(id) }
  }, [patchGen])

  const startGen = useCallback(async (kind: Gen['kind'], prompt: string, enhanced: string | undefined, opts: SendOpts, files: File[], targetUrl?: string) => {
    const id = uid()
    const g: Gen = { status: 'loading', kind, prompt, enhanced, width: opts.width, height: opts.height, quality: opts.quality, refs: [] }
    const ctrl = new AbortController(); genCtrls.current.set(id, ctrl)
    push({ id, role: 'ai', at: Date.now(), gen: g })
    try {
      const refs: string[] = []
      if (targetUrl) refs.push(await urlToDataUrl(targetUrl))
      for (const f of files) refs.push(await fileToDataUrl(f))
      if (ctrl.signal.aborted) { patchGen(id, { status: 'cancelled' }); genCtrls.current.delete(id); return }
      g.refs = refs; patchGen(id, { refs })
      await runGen(id, g)
    } catch (e) {
      genCtrls.current.delete(id)
      patchGen(id, { status: 'error', error: e instanceof BotError ? e.message : 'Could not prepare the image.' })
    }
  }, [patchGen, push, runGen])

  /** Smooth, adaptive reveal: bursts of tokens are released a few characters per frame, so the answer "types" live. */
  const drain = useRef<ReturnType<typeof createDrain> | null>(null)
  if (!drain.current) {
    drain.current = createDrain(
      (id, chunk) => setMsgs((l) => l.map((m) => (m.id === id ? { ...m, text: (m.text ?? '') + chunk } : m))),
      (id) => { setMsgs((l) => l.map((m) => (m.id === id ? { ...m, streaming: false } : m))); stage.current = null; chatCtrl.current = null; setChatBusy(false) },
    )
  }
  const lastPayload = useRef<{ display: string; send: string; imgs: File[] } | null>(null)
  /** Lets Stop work while the network part is finished but the answer is still being revealed. */
  const stage = useRef<{ netDone: boolean; stop: () => void } | null>(null)

  const runChat = useCallback(async (display: string, sendText: string, imgs: File[]) => {
    const ctrl = new AbortController(); chatCtrl.current = ctrl; setChatBusy(true)
    lastPayload.current = { display, send: sendText, imgs }
    const id = uid()
    const d = drain.current!
    push({ id, role: 'ai', at: Date.now(), text: '', streaming: true })
    d.start(id)
    const settle = (patch: Partial<Msg> | null) => {
      stage.current = null
      d.cancel()
      setMsgs((l) => l.flatMap((m) => (m.id !== id ? [m] : patch ? [{ ...m, ...patch, streaming: false }] : [])))
      chatCtrl.current = null; setChatBusy(false)
    }
    const stopNow = () => { const seen = msgsRef.current.find((m) => m.id === id)?.text ?? ''; settle(seen.trim() ? { stopped: true } : null) }
    stage.current = { netDone: false, stop: stopNow }
    try {
      const r = await streamChat({ message: sendText, sessionId: sessionRef.current, files: imgs, signal: ctrl.signal, onDelta: (c) => d.push(c) })
      if (stage.current) stage.current.netDone = true
      if (!r.streamed) d.push(r.text) // older backend: reveal the full answer progressively
      d.end()
    } catch (e) {
      const err = e instanceof BotError ? e : new BotError('server', 'Something went wrong.')
      const partial = (msgsRef.current.find((m) => m.id === id)?.text ?? '').trim().length > 0 || d.pending() > 0
      if (err.code === 'aborted') {
        // keep what the user already saw; an empty answer simply disappears
        const seen = msgsRef.current.find((m) => m.id === id)?.text ?? ''
        settle(seen.trim() ? { stopped: true } : null)
      } else if (partial) {
        const seen = msgsRef.current.find((m) => m.id === id)?.text ?? ''
        settle(seen.trim() ? { stopped: true, failNote: err.message } : { text: err.message, error: true })
      } else settle({ text: err.message, error: true })
    }
  }, [push])

  /** Returns true when the message was accepted (so the composer can clear itself). */
  const send = useCallback(async (raw: string, prepared: PreparedFile[], opts: SendOpts): Promise<boolean> => {
    const text = raw.trim()
    const imgFiles = prepared.filter((p) => p.kind === 'image').map((p) => p.file)
    const codeFiles = prepared.filter((p) => p.kind === 'code')
    if (!text && prepared.length === 0) return false
    if (Date.now() - lastSend.current < 800) return false
    if (enhancing || pending) { notify('Finish the prompt review first', 'Choose a prompt or cancel before sending another message.'); return false }

    let target = editTarget ? msgsRef.current.find((m) => m.id === editTarget && m.gen?.url) : undefined
    const lastImage = [...msgsRef.current.slice(-6)].reverse().find((m) => m.gen?.status === 'done' && m.gen.url)
    if (opts.mode === 'image' && codeFiles.length) { notify('Code files are not used for images', 'Switch to Chat or Auto mode to ask about code files.'); return false }
    let intent: Intent
    if (opts.mode === 'chat') intent = 'chat'
    else if (opts.mode === 'image') intent = imgFiles.length || target ? 'edit' : 'generate'
    else if (codeFiles.length) intent = 'chat'
    else intent = target ? 'edit' : detectIntent(text, { hasRefs: imgFiles.length > 0, hasRecentImage: !!lastImage })
    // "make it more cinematic" right after an image: edit THAT image instead of generating an unrelated one.
    if (opts.mode === 'auto' && intent === 'edit' && !target && imgFiles.length === 0) target = lastImage
    // Images not configured: never send a request that is guaranteed to fail.
    if (opts.mode === 'auto' && !isImageConfigured && intent !== 'chat') intent = 'chat'

    const needsGen = intent !== 'chat'
    if (needsGen) {
      if (!text) { notify('Describe the image', 'Add a few words about what you want to create or change.'); return false }
      const dim = validateDimensions(opts.width, opts.height)
      if (dim) { notify('Invalid size', dim); return false }
      const total = imgFiles.length + (target ? 1 : 0)
      if (total > LIMITS.maxRefs) { notify('Too many reference images', `Use at most ${LIMITS.maxRefs} (including the image being edited).`); return false }
      for (const f of imgFiles) { const err = validateImageFile(f); if (err) { notify('Unsupported file', err); return false } }
      if (generating) { notify('One image at a time', 'Wait for the current image to finish, or cancel it.'); return false }
    } else {
      if (prepared.length > MAX_CHAT_FILES) { notify('Too many files', `You can attach up to ${MAX_CHAT_FILES} files.`); return false }
      if (chatBusy) return false
    }
    if (intent === 'both' && chatBusy) return false

    lastSend.current = Date.now()
    push({ id: uid(), role: 'user', at: Date.now(), text, files: prepared.map((p) => ({ id: p.id, name: p.name, size: p.size, kind: p.kind, language: p.language, lines: p.lines })), attachments: prepared.filter((p) => p.kind === 'image').map((p) => ({ id: uid(), name: p.name, url: URL.createObjectURL(p.file), image: true })) })
    setEditTarget(null)

    const sendText = buildMessage(text, prepared)
    if (intent === 'chat') { void runChat(text, sendText, imgFiles); return true }
    if (intent === 'both') { void runChat(text, sendText, imgFiles); void startGen('edit', text, undefined, opts, imgFiles); return true }

    const kind: Gen['kind'] = target || imgFiles.length ? 'edit' : 'generate'
    if (opts.enhance) {
      setEnhancing(true)
      try {
        const enhanced = await enhanceImagePrompt(text)
        setPending({ original: text, enhanced, intent: kind, files: imgFiles, opts })
        pendingTarget.current = target?.gen?.url
      } catch {
        notify('Could not enhance the prompt', 'Using your original prompt instead.')
        void startGen(kind, text, undefined, opts, imgFiles, target?.gen?.url)
      } finally { setEnhancing(false) }
      return true
    }
    void startGen(kind, text, undefined, opts, imgFiles, target?.gen?.url)
    return true
  }, [chatBusy, editTarget, enhancing, generating, notify, pending, push, runChat, startGen])

  const confirmPending = useCallback((chosen: 'original' | 'enhanced', editedEnhanced: string) => {
    if (!pending) return
    const enhanced = chosen === 'enhanced' && editedEnhanced.trim() ? editedEnhanced.trim() : undefined
    void startGen(pending.intent, pending.original, enhanced, pending.opts, pending.files, pendingTarget.current)
    setPending(null)
  }, [pending, startGen])
  const cancelPending = useCallback(() => setPending(null), [])

  const cancel = useCallback((id: string) => genCtrls.current.get(id)?.abort(), [])
  const cancelChat = useCallback(() => {
    chatCtrl.current?.abort()
    if (stage.current?.netDone) stage.current.stop()
  }, [])
  const regenerate = useCallback((id: string) => {
    const m = msgsRef.current.find((x) => x.id === id); if (!m?.gen || m.gen.status === 'loading' || generating) return
    if (m.gen.url?.startsWith('blob:')) URL.revokeObjectURL(m.gen.url)
    patchGen(id, { status: 'loading', error: undefined, url: undefined }); void runGen(id, { ...m.gen, status: 'loading' })
  }, [generating, patchGen, runGen])
  const removeMessage = useCallback((id: string) => {
    const m = msgsRef.current.find((x) => x.id === id)
    if (m?.gen?.url?.startsWith('blob:')) URL.revokeObjectURL(m.gen.url)
    if (editTarget === id) setEditTarget(null)
    setMsgs((l) => l.filter((x) => x.id !== id))
  }, [editTarget])
  /** Re-asks the last chat question (used after an error or a stopped answer). */
  const retryLast = useCallback(() => {
    if (chatBusy) return
    const list = msgsRef.current
    const last = list[list.length - 1]
    if (!last || last.role !== 'ai' || last.gen) return
    const payload = lastPayload.current
    const asked = [...list].reverse().find((m) => m.role === 'user')?.text ?? ''
    const display = payload?.display ?? asked
    if (!display.trim() && !payload) return
    setMsgs((l) => l.filter((m) => m.id !== last.id))
    void runChat(display, payload?.send ?? display, payload?.imgs ?? [])
  }, [chatBusy, runChat])
  const clear = useCallback(async () => {
    genCtrls.current.forEach((c) => c.abort()); chatCtrl.current?.abort(); drain.current?.cancel(); stage.current = null; setChatBusy(false)
    msgsRef.current.forEach((m) => { if (m.gen?.url?.startsWith('blob:')) URL.revokeObjectURL(m.gen.url) })
    const old = sessionRef.current
    sessionRef.current = resetSessionId(userId)
    setMsgs([]); setPending(null); setEditTarget(null)
    await clearChat(old)
  }, [userId])

  return { msgs, chatBusy, enhancing, generating, pending, editTarget, setEditTarget, send, confirmPending, cancelPending, cancel, cancelChat, retryLast, regenerate, removeMessage, clear }
}
