/// Python runtime: Pyodide (CPython compiled to WebAssembly) in a module Web Worker. Runs entirely in the browser sandbox.
const PYODIDE_VERSION = '0.29.4'
const INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

interface Py {
  setStdout(o: { batched: (s: string) => void }): void
  setStderr(o: { batched: (s: string) => void }): void
  setStdin(o: { stdin: () => string | undefined }): void
  loadPackagesFromImports(code: string): Promise<void>
  runPythonAsync(code: string, o?: { globals?: unknown }): Promise<unknown>
  globals: { get(name: string): () => { destroy?: () => void } }
}
const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null }
const post = (m: unknown) => ctx.postMessage(m)
let py: Py | null = null
let stdinLines: string[] = []

/** Hide Pyodide's own frames so learners see only their code in the traceback. */
function cleanTrace(msg: string): string {
  const lines = msg.split('\n'); const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+File "\/lib\/python/.test(lines[i])) { while (i + 1 < lines.length && /^ {4,}/.test(lines[i + 1])) i++; continue }
    out.push(lines[i].replace('File "<exec>"', 'File "main.py"'))
  }
  return out.join('\n').trim()
}

async function boot() {
  post({ type: 'status', status: 'loading' })
  try {
    const mod = (await import(/* @vite-ignore */ INDEX + 'pyodide.mjs')) as { loadPyodide(o: { indexURL: string }): Promise<Py> }
    py = await mod.loadPyodide({ indexURL: INDEX })
    py.setStdout({ batched: (s) => post({ type: 'out', stream: 'stdout', text: s + '\n' }) })
    py.setStderr({ batched: (s) => post({ type: 'out', stream: 'stderr', text: s + '\n' }) })
    py.setStdin({ stdin: () => (stdinLines.length ? stdinLines.shift() : undefined) })
    post({ type: 'status', status: 'ready' })
  } catch (e) {
    post({ type: 'status', status: 'failed', text: String(e) })
  }
}

ctx.onmessage = async (ev: MessageEvent) => {
  const m = ev.data as { type: string; code?: string; stdin?: string }
  if (m.type !== 'run' || !py) return
  stdinLines = (m.stdin ?? '').length ? (m.stdin as string).split('\n') : []
  const code = m.code ?? ''
  let ok = true
  try {
    try { await py.loadPackagesFromImports(code) } catch { /* the import error is reported by Python itself */ }
    const g = py.globals.get('dict')()
    try { await py.runPythonAsync(code, { globals: g }) } finally { g.destroy?.() }
  } catch (e) {
    ok = false
    post({ type: 'error', text: cleanTrace(e instanceof Error ? e.message : String(e)) })
  }
  post({ type: 'done', ok })
}
void boot()
