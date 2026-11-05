import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import type { LabLang } from './templates'

/** Pixel-style editor theme: hard edges, the platform's code palette (same colours as lesson code blocks). */
const theme = EditorView.theme({
  '&': { color: '#e8eefc', backgroundColor: 'var(--code-bg)', height: '100%', fontSize: '0.9rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.65', overflow: 'auto' },
  '.cm-content': { caretColor: '#fff', padding: '12px 0' },
  '.cm-cursor': { borderLeftColor: '#fff', borderLeftWidth: '2px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: '#5f6b8c', border: 'none', borderInlineEnd: '2px solid #1b2440' },
  '.cm-activeLine': { backgroundColor: 'rgba(140,182,255,0.08)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(140,182,255,0.12)', color: '#9fb0d6' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(1,95,255,0.45)' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(249,171,0,0.3)', outline: '1px solid #f9ab00' },
  '.cm-tooltip': { backgroundColor: '#121823', border: '2px solid #8cb6ff', color: '#e8eefc', borderRadius: '0' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#015fff', color: '#fff' },
  '.cm-panels': { backgroundColor: '#121823', color: '#e8eefc' },
}, { dark: true })

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: '#8cb6ff', fontWeight: '700' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#8fdc9d' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#ffcf6b' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7b88a8', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: '#ffb4a8' },
  { tag: [t.className, t.typeName], color: '#ffcf6b' },
  { tag: [t.operator, t.punctuation], color: '#9fb0d6' },
  { tag: t.propertyName, color: '#c9d6f5' },
])

const langExt = (l: LabLang) => (l === 'python' ? python() : javascript())

export function CodeEditor({ value, lang, onChange, onRun }: { value: string; lang: LabLang; onChange: (v: string) => void; onRun: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const langC = useRef(new Compartment())
  const cb = useRef({ onChange, onRun })
  useEffect(() => { cb.current = { onChange, onRun } })

  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), foldGutter(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), indentOnInput(), bracketMatching(),
          closeBrackets(), autocompletion(), highlightSelectionMatches(), indentUnit.of('    '), EditorState.tabSize.of(4),
          syntaxHighlighting(highlight), theme, langC.current.of(langExt(lang)),
          EditorView.contentAttributes.of({ 'aria-label': 'Code editor', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          keymap.of([
            { key: 'Mod-Enter', run: () => { cb.current.onRun(); return true } },
            indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap,
          ]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()) }),
        ],
      }),
    })
    view.current = v
    return () => { v.destroy(); view.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { view.current?.dispatch({ effects: langC.current.reconfigure(langExt(lang)) }) }, [lang])
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div className="lab__editor" ref={host} dir="ltr" />
}
