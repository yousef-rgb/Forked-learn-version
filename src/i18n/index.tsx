import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { AR, AR_PATTERNS } from './ar'
import { runLangTransition, type Origin } from './transition'

export type Lang = 'en' | 'ar'
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
]

type Vars = Record<string, string | number>
interface Ctx {
  lang: Lang
  dir: 'ltr' | 'rtl'
  isRtl: boolean
  /** BCP-47 locale for dates/numbers. Arabic keeps Latin digits (0-9) so XP counters and code stay consistent. */
  locale: string
  /** Switches language with the animated transition. `origin` = screen point the reveal expands from (defaults to centre). */
  setLang: (l: Lang, origin?: Origin) => void
  /** Gettext-style: the English text is the key. Missing Arabic entries fall back to the English text. */
  t: (key: string, vars?: Vars) => string
}

const KEY = 'quest.lang'
const interpolate = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s)

/** The two Arabic fonts don't draw "…" or "·"; use look-alikes they do have, so Arabic never falls back to a system font. */
const forArabicFonts = (s: string) => s.replace(/\u2026/g, '...').replace(/\u00b7/g, '-')

function translateRaw(lang: Lang, key: string, vars?: Vars): string {
  if (lang !== 'ar') return interpolate(key, vars)
  const hit = AR[key]
  if (hit !== undefined) return interpolate(hit, vars)
  const tr = (s: string) => AR[s] ?? s
  for (const [re, fn] of AR_PATTERNS) { const m = key.match(re); if (m) { const out = fn(m, tr); if (out !== key) return interpolate(out, vars) } }
  return interpolate(key, vars)
}

export function translate(lang: Lang, key: string, vars?: Vars): string {
  const out = translateRaw(lang, key, vars)
  return lang === 'ar' ? forArabicFonts(out) : out
}

const I18nCtx = createContext<Ctx>({
  lang: 'en', dir: 'ltr', isRtl: false, locale: 'en', setLang: () => undefined, t: (k, v) => interpolate(k, v),
})
export const useI18n = () => useContext(I18nCtx)

const readLang = (): Lang => {
  try { return localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en' } catch { return 'en' }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    const el = document.documentElement
    el.setAttribute('lang', lang)
    el.setAttribute('dir', dir)
  }, [lang, dir])

  const setLang = useCallback((l: Lang, origin?: Origin) => {
    const apply = () => {
      const el = document.documentElement
      el.setAttribute('lang', l)
      el.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr')
      flushSync(() => setLangState(l))
    }
    try { localStorage.setItem(KEY, l) } catch { /* storage unavailable */ }
    void runLangTransition(apply, l, origin)
  }, [])
  const t = useCallback((key: string, vars?: Vars) => translate(lang, key, vars), [lang])

  const value = useMemo<Ctx>(() => ({ lang, dir, isRtl: dir === 'rtl', locale: lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en', setLang, t }), [lang, dir, setLang, t])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}
