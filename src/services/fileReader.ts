/**
 * Reads the files a user attaches to the AI chat, entirely in the browser.
 *  - Code / text / config / data files are read as text and inlined into the message as fenced blocks, so ANY chat backend
 *    (JSON or multipart) receives their content. Jupyter notebooks are flattened to their code, markdown and text outputs.
 *  - Images are validated, downscaled when huge (max side 2048 px) and sent as real files (multipart) for vision models.
 * Nothing here talks to the network.
 */
export const FILE_LIMITS = {
  maxFiles: 8,
  /** Raw size we will even try to read. */
  maxTextBytes: 2 * 1024 * 1024,
  maxImageBytes: 25 * 1024 * 1024,
  /** Characters inlined per file / across the whole message (keeps the prompt inside the model's context window). */
  maxCharsPerFile: 80_000,
  maxCharsTotal: 200_000,
  maxImageSide: 2048,
} as const

/** extension (lowercase, no dot) → fenced-block language */
const CODE: Record<string, string> = {
  py: 'python', pyw: 'python', pyi: 'python', ipynb: 'python',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json', json5: 'json', html: 'html', htm: 'html', xhtml: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  vue: 'vue', svelte: 'svelte', astro: 'astro', md: 'markdown', mdx: 'markdown', txt: 'text', text: 'text', log: 'text', csv: 'csv', tsv: 'tsv',
  xml: 'xml', svg: 'xml', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'properties', env: 'dotenv',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', bat: 'batch', cmd: 'batch', ps1: 'powershell', sql: 'sql',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy', gradle: 'groovy', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', dart: 'dart', lua: 'lua', r: 'r', jl: 'julia', pl: 'perl', pm: 'perl',
  m: 'objectivec', mm: 'objectivec', hs: 'haskell', ex: 'elixir', exs: 'elixir', erl: 'erlang', clj: 'clojure', cljs: 'clojure', ml: 'ocaml', fs: 'fsharp',
  nim: 'nim', zig: 'zig', sol: 'solidity', graphql: 'graphql', gql: 'graphql', proto: 'protobuf', tf: 'hcl', hcl: 'hcl', tex: 'latex',
  glsl: 'glsl', frag: 'glsl', vert: 'glsl', wgsl: 'wgsl', asm: 'asm', s: 'asm', v: 'verilog', sv: 'verilog', vhd: 'vhdl', mk: 'makefile', cmake: 'cmake',
  gitignore: 'text', gitattributes: 'text', editorconfig: 'ini', prettierrc: 'json', eslintrc: 'json', npmrc: 'ini', lock: 'text',
}
/** Files identified by their whole name rather than an extension. */
const NAMED: Record<string, string> = {
  dockerfile: 'dockerfile', makefile: 'makefile', procfile: 'text', gemfile: 'ruby', rakefile: 'ruby', 'cmakelists.txt': 'cmake',
  '.gitignore': 'text', '.gitattributes': 'text', '.env': 'dotenv', '.editorconfig': 'ini', '.prettierrc': 'json', '.eslintrc': 'json', '.npmrc': 'ini',
  license: 'text', readme: 'markdown', 'requirements.txt': 'text',
}
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'ico', 'apng']

/** Value for <input type="file" accept>. */
export const ACCEPT_ATTR = ['image/*', ...IMAGE_EXT.map((e) => `.${e}`), ...Object.keys(CODE).map((e) => `.${e}`), 'text/*'].join(',')

const LABEL: Record<string, string> = {
  python: 'Python', javascript: 'JavaScript', jsx: 'JSX', typescript: 'TypeScript', tsx: 'TSX', json: 'JSON', html: 'HTML', css: 'CSS', scss: 'SCSS',
  markdown: 'Markdown', text: 'Text', bash: 'Shell', sql: 'SQL', java: 'Java', kotlin: 'Kotlin', c: 'C', cpp: 'C++', csharp: 'C#', go: 'Go', rust: 'Rust',
  ruby: 'Ruby', php: 'PHP', swift: 'Swift', dart: 'Dart', yaml: 'YAML', xml: 'XML', csv: 'CSV', dockerfile: 'Dockerfile', vue: 'Vue', svelte: 'Svelte',
}
export const languageLabel = (lang: string) => LABEL[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1)

export class FileError extends Error {
  key: string
  vars?: Record<string, string | number>
  constructor(key: string, vars?: Record<string, string | number>) {
    super(vars ? key.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : key)
    this.key = key; this.vars = vars; this.name = 'FileError'
  }
}

export interface PreparedFile {
  id: string
  name: string
  size: number
  kind: 'image' | 'code'
  /** Image: the (possibly downscaled) file to upload. Code: the original file. */
  file: File
  previewUrl?: string
  language?: string
  text?: string
  lines?: number
  truncated?: boolean
  /** Shown once as a gentle toast (e.g. "this looks like it may hold secrets"). */
  warning?: string
}

const extOf = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 || (i === 0 && name.length > 1) ? name.slice(i + 1).toLowerCase() : '' }
const baseOf = (name: string) => name.split(/[\\/]/).pop() ?? name
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

export const isImageFile = (f: File) => f.type.startsWith('image/') && f.type !== 'image/svg+xml' ? true : IMAGE_EXT.includes(extOf(f.name))

/** Decode as UTF-8; fall back to UTF-16 when a BOM says so (common for files saved by Windows tools). */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const b = new Uint8Array(buf)
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf).replace(/^\uFEFF/, '')
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buf).replace(/^\uFEFF/, '')
  return new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '')
}
const looksBinary = async (file: File) => {
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer())
  if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff)) return false // UTF-16 text
  return head.includes(0)
}

/** Flattens a Jupyter notebook into readable text: markdown cells as comments, code cells verbatim, short text outputs. */
function notebookToText(raw: string): string {
  type Cell = { cell_type?: string; source?: string | string[]; outputs?: { text?: string | string[]; data?: Record<string, string | string[]> }[] }
  const nb = JSON.parse(raw) as { cells?: Cell[] }
  const join = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : s ?? '')
  const out: string[] = []
  for (const c of nb.cells ?? []) {
    const src = join(c.source).trimEnd()
    if (c.cell_type === 'markdown') out.push('# %% [markdown]\n' + src.split('\n').map((l) => `# ${l}`).join('\n'))
    else if (c.cell_type === 'code') {
      out.push('# %%\n' + src)
      for (const o of c.outputs ?? []) {
        const t = join(o.text ?? o.data?.['text/plain']).trim()
        if (t) out.push('# Output:\n' + t.slice(0, 600).split('\n').map((l) => `# ${l}`).join('\n'))
      }
    }
  }
  return out.join('\n\n')
}

const SECRET_HINT = /(api[_-]?key|secret|token|passwd|password|private[_-]?key)\s*[=:]\s*\S{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/i

async function downscale(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(file) } catch { return file } // e.g. HEIC in Chrome: let the backend try the original
  const max = Math.max(bmp.width, bmp.height)
  const small = max <= FILE_LIMITS.maxImageSide && file.size <= 1.5 * 1024 * 1024
  if (small) { bmp.close(); return file }
  const scale = Math.min(1, FILE_LIMITS.maxImageSide / max)
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) { bmp.close(); return file }
  const keepAlpha = /png|gif|apng|webp/.test(file.type)
  if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) }
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close()
  const type = keepAlpha ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.88))
  if (!blob || blob.size >= file.size) return file
  const name = baseOf(file.name).replace(/\.[^.]+$/, '') + (type === 'image/png' ? '.png' : '.jpg')
  return new File([blob], name, { type })
}

export async function prepareFile(file: File): Promise<PreparedFile> {
  const name = baseOf(file.name)
  const ext = extOf(name)
  const lower = name.toLowerCase()

  if (isImageFile(file)) {
    if (file.size > FILE_LIMITS.maxImageBytes) throw new FileError('{name} is over {mb} MB.', { name, mb: FILE_LIMITS.maxImageBytes / 1024 / 1024 })
    const out = await downscale(file)
    return { id: uid(), name, size: out.size, kind: 'image', file: out, previewUrl: URL.createObjectURL(out) }
  }

  const language = NAMED[lower] ?? CODE[ext]
  if (file.size > FILE_LIMITS.maxTextBytes) throw new FileError('{name} is too large to read ({mb} MB max).', { name, mb: FILE_LIMITS.maxTextBytes / 1024 / 1024 })
  if (!language && (await looksBinary(file))) throw new FileError('{name} is a binary file. Attach source code, text, or an image.', { name })
  if (language && ext !== 'ipynb' && (await looksBinary(file))) throw new FileError('{name} is a binary file. Attach source code, text, or an image.', { name })

  let text = await readText(file)
  if (ext === 'ipynb') {
    try { text = notebookToText(text) } catch { throw new FileError('{name} is not a valid Jupyter notebook.', { name }) }
  }
  const lines = text.length ? text.split('\n').length : 0
  let truncated = false
  if (text.length > FILE_LIMITS.maxCharsPerFile) { text = text.slice(0, FILE_LIMITS.maxCharsPerFile); truncated = true }
  const warning = SECRET_HINT.test(text) || lower === '.env' || ext === 'env' ? 'secrets' : undefined
  return { id: uid(), name, size: file.size, kind: 'code', file, language: language ?? 'text', text, lines, truncated, warning }
}

const fenceFor = (s: string) => '`'.repeat(Math.max(3, (s.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0) + 1))

/** The text actually sent to the backend: what the user typed + every code/text file as a fenced block. */
export function buildMessage(userText: string, files: PreparedFile[]): string {
  const code = files.filter((f) => f.kind === 'code')
  const images = files.filter((f) => f.kind === 'image')
  const parts: string[] = []
  const typed = userText.trim()
  parts.push(typed || (files.length ? 'Please review the attached file(s) and tell me what they do and anything that looks wrong or can be improved.' : ''))
  let budget = FILE_LIMITS.maxCharsTotal
  if (code.length) {
    parts.push(`Attached files (${code.length}):`)
    code.forEach((f, i) => {
      let body = f.text ?? ''
      let cut = !!f.truncated
      if (body.length > budget) { body = body.slice(0, Math.max(0, budget)); cut = true }
      budget -= body.length
      const fence = fenceFor(body)
      parts.push(`[File ${i + 1}: ${f.name} — ${languageLabel(f.language ?? 'text')}, ${f.lines ?? 0} lines${cut ? ', truncated for length' : ''}]\n${fence}${f.language ?? ''}\n${body}\n${fence}`)
    })
  }
  if (images.length) parts.push(`(${images.length} image${images.length > 1 ? 's' : ''} attached: ${images.map((i) => i.name).join(', ')})`)
  return parts.filter(Boolean).join('\n\n')
}

export const humanSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
