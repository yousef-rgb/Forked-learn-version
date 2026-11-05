import { Fragment, memo, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, SquareTerminal } from 'lucide-react'
import { highlight } from '../CodeBlock'
import { useI18n } from '../../i18n'

/**
 * Small, dependency-free Markdown renderer that builds React elements (never raw HTML), so model output cannot inject
 * markup or scripts. Supports headings, nested lists, task lists, quotes, tables, rules, fenced code, **bold**, *italic*,
 * ~~strike~~, `code`, [links](https://…) and bare https links. Tolerates half-written Markdown (it is rendered while streaming).
 */
type Align = 'left' | 'right' | 'center' | undefined
type Block =
  | { t: 'p'; lines: string[] }
  | { t: 'h'; level: number; text: string }
  | { t: 'list'; ordered: boolean; items: { text: string; depth: number; task?: boolean; done?: boolean }[] }
  | { t: 'quote'; text: string }
  | { t: 'fence'; lang: string; code: string; open: boolean }
  | { t: 'table'; head: string[]; align: Align[]; rows: string[][] }
  | { t: 'hr' }

const BULLET = /^(\s*)([-*•])\s+(.*)/
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)/
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

function parse(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(/^\s*```\s*([\w+#.-]*)/)
    if (fence) {
      const buf: string[] = []; i++
      let closed = false
      while (i < lines.length) { if (/^\s*```/.test(lines[i])) { closed = true; i++; break } buf.push(lines[i++]) }
      out.push({ t: 'fence', lang: fence[1], code: buf.join('\n'), open: !closed }); continue
    }
    if (!line.trim()) { i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ t: 'hr' }); i++; continue }
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) { out.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line)
      const align: Align[] = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : undefined))
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]))
      out.push({ t: 'table', head, align, rows }); continue
    }
    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line) && !BULLET.test(line)
      const items: Extract<Block, { t: 'list' }>['items'] = []
      while (i < lines.length) {
        const m = lines[i].match(ordered ? ORDERED : BULLET)
        if (!m) break
        let body = m[3]
        let task: boolean | undefined, done: boolean | undefined
        const tk = body.match(/^\[([ xX])\]\s+(.*)/)
        if (tk && !ordered) { task = true; done = tk[1] !== ' '; body = tk[2] }
        items.push({ text: body, depth: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)), task, done }); i++
      }
      out.push({ t: 'list', ordered, items }); continue
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push({ t: 'quote', text: buf.join(' ') }); continue
    }
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*```|^#{1,4}\s|^>|^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !(lines[i].includes('|') && TABLE_SEP.test(lines[i + 1] ?? ''))) buf.push(lines[i++])
    if (buf.length) out.push({ t: 'p', lines: buf }); else i++
  }
  return out
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?])/g
function Inline({ text }: { text: string }) {
  const out: ReactNode[] = []
  let last = 0, m: RegExpExecArray | null, i = 0
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (m[1]) out.push(<code key={i++} className="md-code">{t.slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={i++}>{t.slice(2, -2)}</strong>)
    else if (m[3]) out.push(<del key={i++}>{t.slice(2, -2)}</del>)
    else if (m[4]) out.push(<em key={i++}>{t.slice(1, -1)}</em>)
    else if (m[5]) out.push(<a key={i++} href={m[6]} target="_blank" rel="noopener noreferrer">{t.slice(1, t.indexOf(']'))}</a>)
    else out.push(<a key={i++} href={t} target="_blank" rel="noopener noreferrer">{t}</a>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

const Caret = () => <span className="caret" aria-hidden="true" />

const RUNNABLE: Record<string, 'python' | 'javascript'> = { py: 'python', python: 'python', js: 'javascript', javascript: 'javascript', mjs: 'javascript', node: 'javascript' }

function Fence({ lang, code, open }: { lang: string; code: string; open: boolean }) {
  const { t } = useI18n()
  const nav = useNavigate()
  const [copied, setCopied] = useState(false)
  const l = /^(py|python)$/i.test(lang) ? 'python' : /^(js|javascript|ts|typescript|jsx|tsx|mjs)$/i.test(lang) ? 'js' : 'text'
  const runnable = RUNNABLE[lang.toLowerCase()]
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ } }
  return (
    <div className={`codeblock md-fence ${open ? 'is-open' : ''}`} dir="ltr">
      <div className="codeblock__bar">
        <span>{lang || 'code'}</span>
        <span className="md-fence__tools">
          {runnable && !open && <button type="button" className="linkbtn md-fence__btn" onClick={() => nav('/app/code', { state: { code, lang: runnable } })} aria-label={t('Open in Code Lab')}><SquareTerminal size={14} /> <span>{t('Run')}</span></button>}
          <button type="button" className="linkbtn md-fence__btn" onClick={copy} aria-label={t('Copy code')}>{copied ? <Check size={14} /> : <Copy size={14} />} <span>{copied ? t('Copied') : t('Copy')}</span></button>
        </span>
      </div>
      <pre><code dangerouslySetInnerHTML={{ __html: highlight(code, l) }} /></pre>
    </div>
  )
}

function MarkdownImpl({ text, caret = false }: { text: string; caret?: boolean }) {
  const blocks = useMemo(() => parse(text), [text])
  const last = blocks.length - 1
  const tail = (idx: number) => (caret && idx === last ? <Caret /> : null)
  return (
    <div className="md">
      {blocks.map((b, k) => {
        switch (b.t) {
          case 'fence': return <Fragment key={k}><Fence lang={b.lang} code={b.code} open={b.open} />{tail(k) && <p><Caret /></p>}</Fragment>
          case 'hr': return <hr key={k} className="md-hr" />
          case 'h': return <p key={k} className={`md-h md-h--${b.level}`} dir="auto"><Inline text={b.text} />{tail(k)}</p>
          case 'quote': return <blockquote key={k} className="md-quote" dir="auto"><Inline text={b.text} />{tail(k)}</blockquote>
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul'
            return (
              <L key={k} className="md-list" dir="auto">
                {b.items.map((it, n) => (
                  <li key={n} className={`${it.depth ? `md-d${it.depth}` : ''} ${it.task ? 'md-task' : ''}`}>
                    {it.task && <span className={`md-box ${it.done ? 'is-on' : ''}`} aria-hidden="true">{it.done ? '✓' : ''}</span>}
                    <Inline text={it.text} />{n === b.items.length - 1 && tail(k)}
                  </li>
                ))}
              </L>
            )
          }
          case 'table':
            return (
              <div key={k} className="md-table-wrap" tabIndex={0}>
                <table className="md-table">
                  <thead><tr>{b.head.map((c, n) => <th key={n} style={{ textAlign: b.align[n] }} dir="auto"><Inline text={c} /></th>)}</tr></thead>
                  <tbody>{b.rows.map((r, n) => <tr key={n}>{b.head.map((_, c) => <td key={c} style={{ textAlign: b.align[c] }} dir="auto"><Inline text={r[c] ?? ''} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            )
          default:
            return <p key={k} dir="auto">{b.lines.map((t, n) => <Fragment key={n}>{n > 0 && <br />}<Inline text={t} /></Fragment>)}{tail(k)}</p>
        }
      })}
      {caret && blocks.length === 0 && <p><Caret /></p>}
    </div>
  )
}
export const Markdown = memo(MarkdownImpl)
