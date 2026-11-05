/**
 * Lightweight, dependency-free intent detection (English + Arabic).
 * It only decides what the *composer* does with a message; the manual mode switch (Auto/Chat/Image) always wins.
 *
 * English words use \b so "icon" does not match "silicon" and "logo" does not match "analogous".
 * (\b does not work for Arabic, so the Arabic words sit in a separate alternative.)
 */
export type Intent = 'chat' | 'generate' | 'edit' | 'both'

const GEN_VERB = /\b(generate|create|draw|make me|make a|design|render|paint|illustrate|imagine|produce|sketch)\b|(ولد|اعمل|اعملي|صمم|ارسم|ارسملي|انشئ|أنشئ|اصنع|عايز|عاوز|أريد|اريد)/i
const IMG_NOUN = /\b(images?|pictures?|photos?|illustrations?|logos?|posters?|wallpapers?|artworks?|icons?|banners?|portraits?|infographics?|avatars?|stickers?|drawings?|thumbnails?)\b|(صورة|صوره|صور|رسمة|رسمه|لوجو|شعار|بوستر|خلفية|ايقونة|أيقونة|انفوجراف|إنفوجراف|رسم)/i
/** Visual-scene wording that makes a bare "generate/create …" an image request even without the word "image". */
const VISUAL = /\b(cinematic|photorealistic|realistic|futuristic|pixel art|watercolor|oil painting|anime|3d render|concept art|digital art|at night|at sunset|sunset|neon|4k|8k)\b|(مستقبلي|واقعي|سينمائي)/i
const DRAW_ONLY = /^\s*(draw|paint|sketch|ارسم|ارسملي)(\s|$)/i
const IMG_OF = /\b(image|picture|photo|illustration) of\b|(صورة|صوره|رسمة) (ل|عن)/i
const EDIT_VERB = /\b(make (it|this|the|him|her|them)|change|edit|remove|replace|add|turn (it|this)|brighten|darken|more|less|cinematic|background|lighting|style|enhance)\b|(غير|عدل|شيل|احذف|ضيف|خلي|حول|اجعل|زود|قلل)/i
const EXPLAIN = /^\s*(explain|what is|what's|what are|how (do|does|to|can)|why|define|who|when|summarize|translate)\b|^\s*(اشرح|يعني ايه|ايه هو|إيه|ازاي|كيف|لماذا|ليه|عرف|لخص|ترجم)/i
const ANALYZE = /\b(explain|describe|analy[sz]e|what is in|what's in)\b|(اشرح|وصف|حلل|ايه اللي في)/i

/** Programming context: "create a React component that shows an image" is a coding request, not an image request. */
const CODE_CTX = /```|\b(function|component|react|vue|angular|css|html|javascript|typescript|python|java|sql|api|backend|frontend|script|code|class|variable|loop|array|canvas|svg|bug|error|library|framework|json|tailwind|npm|node)\b|(كود|برمجة|دالة|فانكشن|ايرور|خطأ برمجي)/i
/** An unmistakable image request ("create an image of…", "make a logo for…") wins over code words. */
const EXPLICIT_IMAGE = /\b(generate|create|draw|make|design|produce)\s+(me\s+)?(an?\s+)?(\w+\s+)?(image|picture|photo|logo|poster|illustration|artwork|wallpaper|avatar|sticker)\s+(of|for|showing|with)\b|(ارسم|صمم|ولد|اعمل|اعملي)\s+(لي\s+|ليا\s+)?(صورة|صوره|لوجو|بوستر|شعار)/i

export function detectIntent(text: string, ctx: { hasRefs: boolean; hasRecentImage: boolean }): Intent {
  const t = text.trim()
  if (!t) return 'chat'
  const wantsNew = (GEN_VERB.test(t) && (IMG_NOUN.test(t) || VISUAL.test(t))) || IMG_OF.test(t) || DRAW_ONLY.test(t)
  if (CODE_CTX.test(t) && !EXPLICIT_IMAGE.test(t)) return 'chat'
  const pureQuestion = EXPLAIN.test(t) && !wantsNew
  if (pureQuestion) return 'chat'
  if (wantsNew) return ctx.hasRefs && ANALYZE.test(t) ? 'both' : ctx.hasRefs ? 'edit' : 'generate'
  if ((ctx.hasRefs || ctx.hasRecentImage) && EDIT_VERB.test(t) && t.length <= 400) return 'edit'
  return 'chat'
}
