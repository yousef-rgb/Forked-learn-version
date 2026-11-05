import type { Lang } from './index'

/**
 * Animated language switch.
 *  - Modern browsers: View Transitions API → the new language (and its mirrored RTL/LTR layout) is revealed by a
 *    circle that expands from the button that was pressed.
 *  - Other browsers: a soft blur + fade + slide on the app root.
 *  - Reduced motion: instant switch.
 * The Arabic fonts are preloaded first so the new snapshot never flashes a fallback font.
 */
export interface Origin { x: number; y: number }

const ARABIC_FONTS = ["400 1em 'ForkedArabicHeading'", "400 1em 'ForkedArabicBody'"]
const SAMPLE = 'عربي أبجد هوز'
let busy = false

/** Start fetching the Arabic fonts early (hover / focus on the toggle). Safe to call repeatedly. */
export function preloadArabicFonts(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  return Promise.all(ARABIC_FONTS.map((f) => document.fonts.load(f, SAMPLE))).catch(() => undefined)
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('no-motion')

type VTDocument = Document & { startViewTransition?: (cb: () => void | Promise<void>) => { ready: Promise<void>; finished: Promise<void> } }

export function isLangTransitionBusy() { return busy }

/** Runs `update` (which must synchronously apply the new language to the DOM) inside the transition. */
export async function runLangTransition(update: () => void, target: Lang, origin?: Origin): Promise<void> {
  if (busy) { update(); return }
  if (prefersReducedMotion()) { update(); return }
  busy = true
  const html = document.documentElement
  try {
    if (target === 'ar') await Promise.race([preloadArabicFonts(), wait(800)])
    const doc = document as VTDocument
    const x = origin?.x ?? window.innerWidth / 2
    const y = origin?.y ?? window.innerHeight / 2

    if (doc.startViewTransition) {
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
      html.classList.add('lang-vt')
      const vt = doc.startViewTransition(update)
      try {
        await vt.ready
        html.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 820, easing: 'cubic-bezier(0.65, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      } catch { /* transition skipped (tab hidden etc.) — the update still ran */ }
      await vt.finished.catch(() => undefined)
      html.classList.remove('lang-vt')
      return
    }

    const root = document.getElementById('root')
    if (!root) { update(); return }
    const out = root.animate(
      [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(6px)' }],
      { duration: 170, easing: 'ease-in', fill: 'forwards' },
    )
    await out.finished
    update()
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    const back = root.animate(
      [{ opacity: 0, filter: 'blur(6px)', transform: 'translateY(10px)' }, { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)' }],
      { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    )
    await back.finished
    out.cancel()
  } finally {
    html.classList.remove('lang-vt')
    busy = false
  }
}
