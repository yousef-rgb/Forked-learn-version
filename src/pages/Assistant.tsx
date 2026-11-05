import { BotChat } from '../components/bot/BotChat'

/** The AI Bot lives ONLY here (/app/assistant). The dashboard home links to it but never embeds a second copy. */
export default function Assistant() {
  return (
    <div className="toolpage">
      <BotChat height="100%" />
    </div>
  )
}
