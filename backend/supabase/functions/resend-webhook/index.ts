// Resend calls this when an email is delivered, opened, bounced or marked as spam, and when a firm's domain changes
// status, so campaign results, message statuses and Settings stay accurate without anyone refreshing.
// Webhook (Resend → Webhooks): https://<project>.supabase.co/functions/v1/resend-webhook
// Events: email.delivered, email.opened, email.clicked, email.bounced, email.complained, domain.updated
// Its signing secret is saved as RESEND_WEBHOOK_SECRET. Deployed with verify_jwt off (Resend has no Supabase login).
import { HttpError, admin, env, json } from '../_shared/core.ts'
import { type ResendDomain, saveDomain } from '../_shared/domains.ts'

/** Checks Resend's (Svix) signature, so nobody else can post fake events. */
async function verify(req: Request, raw: string) {
  const id = req.headers.get('svix-id'), ts = req.headers.get('svix-timestamp'), sigs = req.headers.get('svix-signature')
  if (!id || !ts || !sigs) throw new HttpError(401, 'Missing signature')
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new HttpError(401, 'Stale event')
  const secret = Uint8Array.from(atob(env('RESEND_WEBHOOK_SECRET').replace(/^whsec_/, '')), ch => ch.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${raw}`)))
  const expected = btoa(String.fromCharCode(...mac))
  if (!sigs.split(' ').some(s => s.split(',')[1] === expected)) throw new HttpError(401, 'Bad signature')
}

// Events can arrive out of order (an open before its delivery), so a status only ever moves forward.
const STATUS: Record<string, 'delivered' | 'opened' | 'failed'> = {
  'email.delivered': 'delivered', 'email.opened': 'opened', 'email.clicked': 'opened', 'email.bounced': 'failed', 'email.complained': 'failed',
}
const BEFORE: Record<string, string[]> = { delivered: ['queued', 'sent'], opened: ['queued', 'sent', 'delivered'], failed: ['queued', 'sent', 'delivered'] }

Deno.serve(async req => {
  try {
    if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
    const raw = await req.text()
    await verify(req, raw)
    const event = JSON.parse(raw) as { type: string; data: Record<string, unknown> }
    const db = admin()

    if (event.type === 'domain.updated' || event.type === 'domain.created') {
      const d = event.data as unknown as ResendDomain
      const { data: firm } = await db.from('firms').select('id').eq('resend_domain_id', d.id).maybeSingle()
      if (!firm) return json({ ignored: 'domain not linked to a firm' })
      return json(await saveDomain(db, firm.id, d))
    }

    const status = STATUS[event.type]
    const pid = event.data?.email_id as string | undefined
    if (!status || !pid) return json({ ignored: event.type })

    const { data: msg } = await db.from('messages').update({ status }).eq('provider_id', pid).in('status', BEFORE[status]).select('id, firm_id, lead_id, subject').maybeSingle()
    if (status === 'opened') await db.from('campaign_recipients').update({ opened: true }).eq('provider_id', pid)
    if (status === 'failed') await db.from('campaign_recipients').update({ status: 'failed' }).eq('provider_id', pid)

    // A bounce or spam complaint goes on the lead's timeline; a complaint also means: stop messaging this person.
    if (msg?.lead_id && (event.type === 'email.bounced' || event.type === 'email.complained')) {
      const bounced = event.type === 'email.bounced'
      await db.from('lead_activities').insert({
        firm_id: msg.firm_id, lead_id: msg.lead_id, type: 'email', cls: 'bad',
        title: bounced ? 'Email bounced' : 'Marked an email as spam',
        text: bounced ? `“${msg.subject ?? 'Email'}” couldn’t be delivered. Check the email address.` : `Marked “${msg.subject ?? 'an email'}” as spam, so they won’t get campaign or automatic messages any more.`,
      })
      if (!bounced) await db.from('leads').update({ opted_out: true }).eq('id', msg.lead_id)
    }
    return json({ ok: true })
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status >= 500) console.error(e)
    return json({ error: e instanceof Error ? e.message : 'Error' }, status)
  }
})
