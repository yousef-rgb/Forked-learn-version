import { preloadArabicFonts } from '../i18n/transition'
import { useI18n } from '../i18n'

/** One-tap English ⇄ Arabic switch (shows the language you will switch TO). The reveal animation grows out of this button. */
export function LangToggle() {
  const { lang, setLang } = useI18n()
  const next = lang === 'ar' ? 'en' : 'ar'
  return (
    <button
      type="button"
      className="icon-btn langbtn"
      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setLang(next, { x: r.left + r.width / 2, y: r.top + r.height / 2 }) }}
      onPointerEnter={preloadArabicFonts}
      onFocus={preloadArabicFonts}
      aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
      title={lang === 'ar' ? 'English' : 'العربية'}
    >
      <span key={lang} className="langbtn__glyph" aria-hidden="true">{lang === 'ar' ? 'EN' : 'ع'}</span>
    </button>
  )
}
