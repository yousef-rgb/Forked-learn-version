import { API_BASE_URL } from '../lib/env'
import { supabase } from '../lib/supabaseClient'

export class BotError extends Error {
  code: 'config' | 'auth' | 'rate' | 'network' | 'timeout' | 'aborted' | 'invalid' | 'server'
  constructor(code: BotError['code'], message: string) { super(message); this.code = code; this.name = 'BotError' }
}

export const CHAT_TIMEOUT_MS = 90_000
export const MAX_CHAT_FILES = 8
/** Streaming: max wait for the first byte, then max silence between chunks. */
export const STREAM_FIRST_BYTE_MS = 90_000
export const STREAM_IDLE_MS = 45_000

/** Stable per-user conversation id (kept in this browser only; the backend owns the real history). */
export function getSessionId(userId: string): string {
  const key = `forkedai:session:${userId}`
  try {
    const found = localStorage.getItem(key)
    if (found) return found
    const id = crypto.randomUUID()
    localStorage.setItem(key, id)
    return id
  } catch { return crypto.randomUUID() }
}
export function resetSessionId(userId: string): string {
  const id = crypto.randomUUID()
  try { localStorage.setItem(`forkedai:session:${userId}`, id) } catch { /* private mode */ }
  return id
}

export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Merges the caller's abort signal with a timeout so a hung request always ends. */
export function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const ctrl = new AbortController()
  let timedOut = false
  const t = window.setTimeout(() => { timedOut = true; ctrl.abort() }, ms)
  const onAbort = () => ctrl.abort()
  if (signal?.aborted) ctrl.abort(); else signal?.addEventListener('abort', onAbort, { once: true })
  return { signal: ctrl.signal, timedOut: () => timedOut, done: () => { window.clearTimeout(t); signal?.removeEventListener('abort', onAbort) } }
}

export function statusToError(status: number, serverMsg?: string): BotError {
  if (status === 401 || status === 403) return new BotError('auth', 'Your session expired or you are not allowed to do this. Please log in again.')
  if (status === 429) return new BotError('rate', 'Too many requests. Please wait a moment and try again.')
  if (status === 400 || status === 413 || status === 415 || status === 422) return new BotError('invalid', serverMsg || 'The request was rejected. Check your message or files and try again.')
  return new BotError('server', serverMsg || 'The AI service had a problem. Please try again.')
}

export const networkError = (timedOut: boolean, aborted: boolean) =>
  aborted ? new BotError('aborted', 'Cancelled.')
    : timedOut ? new BotError('timeout', 'This is taking too long. Please try again.')
      : new BotError('network', 'Could not reach the server. Check your connection, or the server CORS settings.')

interface ChatArgs { message: string; sessionId: string; files?: File[]; signal?: AbortSignal }

/** Sends one message to the web backend. Contract: POST {base}/chat → { success, data: { response } } (markdown). */
export async function sendChat({ message, sessionId, files = [], signal }: ChatArgs): Promise<string> {
  if (!API_BASE_URL) throw new BotError('config', 'The chat server is not configured (VITE_API_BASE_URL is missing).')
  const t = withTimeout(signal, CHAT_TIMEOUT_MS)
  try {
    const auth = await authHeaders()
    let init: RequestInit
    if (files.length) {
      const fd = new FormData()
      fd.append('message', message)
      fd.append('sessionId', sessionId)
      files.forEach((f) => fd.append('files', f))
      init = { method: 'POST', body: fd, headers: auth }
    } else {
      init = { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ message, sessionId }) }
    }
    const res = await fetch(`${API_BASE_URL}/chat`, { ...init, signal: t.signal })
    const body = await res.json().catch(() => null) as { success?: boolean; message?: string; error?: string; data?: { response?: string } } | null
    if (!res.ok || !body?.success) throw statusToError(res.status, body?.message || body?.error)
    const text = body.data?.response
    if (!text) throw new BotError('server', 'The assistant returned an empty answer. Please try again.')
    return text
  } catch (e) {
    if (e instanceof BotError) throw e
    throw networkError(t.timedOut(), t.signal.aborted && !t.timedOut())
  } finally { t.done() }
}

export async function clearChat(sessionId: string): Promise<void> {
  if (!API_BASE_URL) return
  try {
    await fetch(`${API_BASE_URL}/chat/clear`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ sessionId }) })
  } catch { /* best effort */ }
}

/** Asks the SAME backend model to rewrite an image prompt. Uses a throwaway session so chat history stays clean. */
export async function enhanceImagePrompt(prompt: string, signal?: AbortSignal): Promise<string> {
  const sessionId = `enhance-${crypto.randomUUID()}`
  const instruction =
    'Rewrite the following image-generation prompt into one richer prompt. Add only relevant detail about composition, lighting, camera angle, ' +
    'environment, materials, style, color palette and rendering quality. Keep the user\'s subject and intent exactly; never add unrelated objects, people or text. ' +
    'Reply with ONLY the rewritten prompt, in English, no quotes, no preface, max 120 words.\n\nPrompt: ' + prompt
  try {
    const out = await sendChat({ message: instruction, sessionId, signal })
    return out.replace(/^["'`\s]+|["'`\s]+$/g, '').replace(/^(enhanced )?prompt:\s*/i, '').slice(0, 1500)
  } finally { void clearChat(sessionId) }
}

/* ───────────── Live streaming ─────────────
 * Contract (backward compatible): the same POST {base}/chat, with the header `Accept: text/event-stream`.
 *  - Backend that streams  → Content-Type text/event-stream (SSE), application/x-ndjson, or plain chunked text.
 *  - Older backend         → Content-Type application/json { success, data: { response } }; the UI then reveals it progressively.
 * SSE `data:` payloads may be raw text or JSON in any of these shapes: { delta | token | text | content | response },
 * OpenAI { choices:[{ delta:{ content } }] }, Anthropic { type:'content_block_delta', delta:{ text } }, or { data:{ response } }.
 * `[DONE]` or `event: done` ends the stream; `event: error` / { error } / { success:false } raises a friendly error. */
export interface StreamArgs extends ChatArgs { onDelta: (chunk: string) => void }
export interface StreamResult { text: string; streamed: boolean }

function idleGuard(signal: AbortSignal | undefined) {
  const ctrl = new AbortController()
  let timedOut = false
  let timer = 0
  const arm = (ms: number) => { window.clearTimeout(timer); timer = window.setTimeout(() => { timedOut = true; ctrl.abort() }, ms) }
  const onAbort = () => ctrl.abort()
  if (signal?.aborted) ctrl.abort(); else signal?.addEventListener('abort', onAbort, { once: true })
  arm(STREAM_FIRST_BYTE_MS)
  return { signal: ctrl.signal, touch: () => arm(STREAM_IDLE_MS), timedOut: () => timedOut, done: () => { window.clearTimeout(timer); signal?.removeEventListener('abort', onAbort) } }
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object'

function pickDelta(o: unknown): string | null {
  if (typeof o === 'string') return o
  if (!isObj(o)) return null
  const choices = o.choices
  if (Array.isArray(choices) && isObj(choices[0])) {
    const c = choices[0]
    const d = (isObj(c.delta) ? c.delta.content : undefined) ?? c.text ?? (isObj(c.message) ? c.message.content : undefined)
    if (typeof d === 'string') return d
  }
  if (o.type === 'content_block_delta' && isObj(o.delta) && typeof o.delta.text === 'string') return o.delta.text
  for (const k of ['delta', 'token', 'text', 'content', 'response', 'chunk']) { const v = o[k]; if (typeof v === 'string') return v }
  if (isObj(o.data)) return pickDelta(o.data)
  return null
}

function pickError(o: unknown): string | null {
  if (!isObj(o)) return null
  if (o.success === false) return String(o.message ?? o.error ?? 'The AI service had a problem. Please try again.')
  const e = o.error
  if (typeof e === 'string' && e) return e
  if (isObj(e) && typeof e.message === 'string') return e.message
  return null
}

async function consumeStream(res: Response, kind: 'sse' | 'ndjson' | 'text', onDelta: (c: string) => void, touch: () => void): Promise<string> {
  if (!res.body) throw new BotError('server', 'The assistant returned an empty answer. Please try again.')
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let all = ''
  const st = { final: '' }
  const emit = (c: string) => { if (c) { all += c; onDelta(c) } }
  const handlePayload = (payload: string, event: string) => {
    if (payload === '[DONE]') return 'done'
    let parsed: unknown = payload
    try { parsed = JSON.parse(payload) } catch { /* raw text delta */ }
    const err = event === 'error' ? (pickError(parsed) ?? (isObj(parsed) && typeof parsed.message === 'string' ? parsed.message : typeof parsed === 'string' ? parsed : 'The AI service had a problem.')) : pickError(parsed)
    if (err) throw new BotError('server', err)
    const text = pickDelta(parsed)
    if (/^(done|end|final|complete)$/i.test(event) || (isObj(parsed) && parsed.done === true)) { if (text) st.final = text; return 'done' }
    if (text) emit(text)
    return 'ok'
  }
  const flush = (last: boolean) => {
    if (kind === 'text') { emit(buf); buf = ''; return }
    if (kind === 'ndjson') {
      const lines = buf.split('\n'); buf = last ? '' : (lines.pop() ?? '')
      for (const l of lines) { const t = l.trim(); if (t) handlePayload(t, '') }
      return
    }
    const frames = buf.split(/\r?\n\r?\n/); buf = last ? '' : (frames.pop() ?? '')
    for (const fr of frames) {
      let event = ''; const data: string[] = []
      for (const line of fr.split(/\r?\n/)) {
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length || event) handlePayload(data.join('\n'), event)
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    touch()
    buf += dec.decode(value, { stream: true })
    flush(false)
  }
  buf += dec.decode()
  flush(true)
  if (!all && st.final) emit(st.final)
  return all
}

/** Sends one message and reports the answer live through onDelta (only when the backend really streams). */
export async function streamChat({ message, sessionId, files = [], signal, onDelta }: StreamArgs): Promise<StreamResult> {
  if (!API_BASE_URL) throw new BotError('config', 'The chat server is not configured (VITE_API_BASE_URL is missing).')
  const g = idleGuard(signal)
  try {
    const auth = await authHeaders()
    const accept = { Accept: 'text/event-stream, application/x-ndjson;q=0.9, application/json;q=0.8' }
    let init: RequestInit
    if (files.length) {
      const fd = new FormData()
      fd.append('message', message); fd.append('sessionId', sessionId)
      files.forEach((f) => fd.append('files', f))
      init = { method: 'POST', body: fd, headers: { ...auth, ...accept } }
    } else {
      init = { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth, ...accept }, body: JSON.stringify({ message, sessionId }) }
    }
    const res = await fetch(`${API_BASE_URL}/chat`, { ...init, signal: g.signal })
    g.touch()
    const type = (res.headers.get('content-type') ?? '').toLowerCase()
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { message?: string; error?: string } | null
      throw statusToError(res.status, body?.message || (typeof body?.error === 'string' ? body.error : undefined))
    }
    if (type.includes('application/json')) {
      const body = await res.json().catch(() => null) as { success?: boolean; message?: string; error?: string; data?: { response?: string } } | null
      if (!body?.success) throw statusToError(res.status, body?.message || body?.error)
      const text = body.data?.response
      if (!text) throw new BotError('server', 'The assistant returned an empty answer. Please try again.')
      return { text, streamed: false }
    }
    const kind = type.includes('event-stream') ? 'sse' : type.includes('ndjson') || type.includes('jsonl') ? 'ndjson' : 'text'
    const text = await consumeStream(res, kind, onDelta, g.touch)
    if (!text.trim()) throw new BotError('server', 'The assistant returned an empty answer. Please try again.')
    return { text, streamed: true }
  } catch (e) {
    if (e instanceof BotError) throw e
    throw networkError(g.timedOut(), g.signal.aborted && !g.timedOut())
  } finally { g.done() }
}
