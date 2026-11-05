import type { LabLang } from './templates'

export type Stream = 'stdout' | 'stderr'
export type RuntimeStatus = 'idle' | 'loading' | 'ready' | 'running' | 'failed'
export interface RunHandlers { onOut: (stream: Stream, text: string) => void; onStatus: (s: RuntimeStatus) => void }
export interface RunResult { ok: boolean; ms: number; timedOut: boolean; stopped: boolean }

export const RUN_TIMEOUT_MS = 15_000
const BOOT_TIMEOUT_MS = 90_000

/** JavaScript runs in a throw-away Web Worker (no DOM, no cookies, killable). The user's code is the worker script itself, so no eval is needed. */
function jsSource(code: string, stdin: string[]) {
  const head = `'use strict';
const __post = (m) => self.postMessage(m);
const __in = ${JSON.stringify(stdin)};
const __fmt = (v, d = 0, seen = new WeakSet()) => {
  if (typeof v === 'string') return d ? JSON.stringify(v) : v;
  if (typeof v === 'bigint') return v + 'n';
  if (typeof v === 'function') return '[Function' + (v.name ? ': ' + v.name : '') + ']';
  if (typeof v === 'symbol') return v.toString();
  if (v === null || typeof v !== 'object') return String(v);
  if (seen.has(v)) return '[Circular]';
  if (d > 3) return Array.isArray(v) ? '[Array]' : '[Object]';
  seen.add(v);
  let r;
  if (v instanceof Error) r = v.stack || String(v);
  else if (Array.isArray(v)) r = '[' + v.map((x) => __fmt(x, d + 1, seen)).join(', ') + ']';
  else if (v instanceof Map) r = 'Map(' + v.size + ') {' + [...v].map(([k, x]) => __fmt(k, d + 1, seen) + ' => ' + __fmt(x, d + 1, seen)).join(', ') + '}';
  else if (v instanceof Set) r = 'Set(' + v.size + ') {' + [...v].map((x) => __fmt(x, d + 1, seen)).join(', ') + '}';
  else r = '{ ' + Object.entries(v).map(([k, x]) => k + ': ' + __fmt(x, d + 1, seen)).join(', ') + ' }';
  seen.delete(v);
  return r;
};
const __join = (a) => a.map((x) => __fmt(x)).join(' ');
const __out = (s) => (...a) => __post({ type: 'out', stream: s, text: __join(a) + '\\n' });
const console = { log: __out('stdout'), info: __out('stdout'), debug: __out('stdout'), table: __out('stdout'), dir: __out('stdout'), warn: __out('stderr'), error: __out('stderr') };
const input = (p = '') => { if (p) __post({ type: 'out', stream: 'stdout', text: String(p) }); const v = __in.shift(); return v === undefined ? '' : v; };
const prompt = input;
(async () => {
try {
`
  const tail = `
} catch (e) { __post({ type: 'error', text: (e && e.stack) ? String(e.stack) : String(e) }); }
__post({ type: 'done' });
})();
`
  return { src: head + code + tail, offset: head.split('\n').length - 1 }
}

export class LabRunner {
  private py: Worker | null = null
  private pyReady: Promise<boolean> | null = null
  private js: Worker | null = null
  private finish: ((r: Partial<RunResult>) => void) | null = null
  private handlers: RunHandlers | null = null

  private bootPython(h: RunHandlers): Promise<boolean> {
    if (this.pyReady && this.py) return this.pyReady
    h.onStatus('loading')
    const w = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' })
    this.py = w
    this.pyReady = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => { resolve(false) }, BOOT_TIMEOUT_MS)
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; status?: string; stream?: Stream; text?: string; ok?: boolean }
        if (m.type === 'status') {
          if (m.status === 'ready') { window.clearTimeout(timer); resolve(true) }
          if (m.status === 'failed') { window.clearTimeout(timer); resolve(false) }
        } else this.route(m)
      }
      w.onerror = () => { window.clearTimeout(timer); resolve(false) }
    })
    return this.pyReady
  }

  /** Start loading Python in the background (called when the user opens the Python tab). */
  warm(h: RunHandlers) { void this.bootPython(h).then((ok) => h.onStatus(ok ? 'ready' : 'failed')) }

  private route(m: { type: string; stream?: Stream; text?: string; ok?: boolean }) {
    if (m.type === 'out' && m.stream) this.handlers?.onOut(m.stream, m.text ?? '')
    else if (m.type === 'error') this.handlers?.onOut('stderr', (m.text ?? '') + '\n')
    else if (m.type === 'done') this.finish?.({ ok: m.ok !== false })
  }

  async run(lang: LabLang, code: string, stdin: string, h: RunHandlers): Promise<RunResult> {
    this.stop(false)
    this.handlers = h
    const lines = stdin.length ? stdin.split('\n') : []
    if (lang === 'python') {
      const ok = await this.bootPython(h)
      if (!ok) { this.py?.terminate(); this.py = null; this.pyReady = null; h.onStatus('failed'); h.onOut('stderr', 'Could not load the Python runtime. Check your connection and try again.\n'); return { ok: false, ms: 0, timedOut: false, stopped: false } }
    }
    h.onStatus('running')
    const t0 = performance.now()
    return new Promise<RunResult>((resolve) => {
      let settled = false
      const end = (r: Partial<RunResult>) => {
        if (settled) return
        settled = true; window.clearTimeout(timer); this.finish = null
        if (lang === 'javascript') { this.js?.terminate(); this.js = null }
        h.onStatus(lang === 'python' && this.py ? 'ready' : 'idle')
        resolve({ ok: true, ms: Math.round(performance.now() - t0), timedOut: false, stopped: false, ...r })
      }
      this.finish = (r) => end(r)
      const timer = window.setTimeout(() => {
        if (lang === 'python') { this.py?.terminate(); this.py = null; this.pyReady = null }
        end({ ok: false, timedOut: true })
      }, RUN_TIMEOUT_MS)
      if (lang === 'python') this.py?.postMessage({ type: 'run', code, stdin })
      else {
        const { src, offset } = jsSource(code, lines)
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
        const w = new Worker(url)
        this.js = w
        const fix = (s: string) => s.replace(/(?:blob:[^\s):]+|<anonymous>):(\d+):(\d+)/g, (_m, l: string, c: string) => `main.js:${Math.max(1, Number(l) - offset)}:${c}`)
        w.onmessage = (e: MessageEvent) => {
          const m = e.data as { type: string; stream?: Stream; text?: string }
          if (m.type === 'error') { h.onOut('stderr', fix(m.text ?? '') + '\n'); end({ ok: false }) }
          else if (m.type === 'done') end({})
          else this.route(m)
        }
        w.onerror = (e) => { e.preventDefault(); h.onOut('stderr', `SyntaxError: ${e.message.replace(/^Uncaught /, '')}${e.lineno ? ` (main.js:${Math.max(1, e.lineno - offset)})` : ''}\n`); end({ ok: false }) }
        window.setTimeout(() => URL.revokeObjectURL(url), 5000)
      }
    })
  }

  /** Stops the current run. Python restarts on the next run (the runtime is cached by the browser, so it is quick). */
  stop(report = true) {
    const f = this.finish
    if (this.js) { this.js.terminate(); this.js = null }
    if (report && f) {
      if (this.py) { this.py.terminate(); this.py = null; this.pyReady = null }
      f({ ok: false, stopped: true })
    }
  }
  dispose() { this.stop(false); this.py?.terminate(); this.py = null; this.pyReady = null }
}
