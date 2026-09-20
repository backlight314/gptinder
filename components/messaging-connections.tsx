import { Check, MessageCircle, MessagesSquare } from 'lucide-react'

export default function MessagingConnections({ discord, whatsapp }: { discord: boolean; whatsapp: boolean }) {
  if (!discord && !whatsapp) return null
  return <div className="messaging-connections" aria-label="Connected messaging apps">
    {whatsapp && <div className="messaging-connection messaging-whatsapp"><span className="messaging-icon"><MessageCircle size={17} /></span><div><strong>WhatsApp</strong><p>Connected</p></div><Check className="messaging-check" size={15} /></div>}
    {discord && <div className="messaging-connection messaging-discord"><span className="messaging-icon"><MessagesSquare size={17} /></span><div><strong>Discord</strong><p>Connected</p></div><Check className="messaging-check" size={15} /></div>}
  </div>
}
