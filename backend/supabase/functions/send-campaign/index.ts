// Sends a one-off campaign or survey to its audience. Emails go out through Resend in batches of 100, from the
// firm's own domain. Texts are held until a texting provider (RingCentral or Twilio) is connected. People who opted
// out are skipped. Each recipient, message and timeline entry is recorded.
// POST { campaign_id, firm_id? }
//
// One request handles audiences of up to MAX_AUDIENCE people. Bigger sends should move to a queue (Supabase Queues
// or pg_cron) that calls this function per chunk.
import { HttpError, admin, audit, body, caller, handle, json } from '../_shared/core.ts'
import { type Email, type FirmRow, type LeadRow, type Tag, brandOf, emailBlocked, fill, fromAddress, renderEmail, sendBatch, textBlocked, unsubscribeLinks } from '../_shared/messaging.ts'

const MAX_AUDIENCE = 2000
const AUDIENCE: Record<string, (l: LeadRow) => boolean> = {
  open: l => !['signed', 'payment', 'delivered', 'lost'].includes(l.stage),
  consult: l => l.stage === 'contacted' || l.stage === 'consult',
  clients: l => ['signed', 'payment', 'delivered'].includes(l.stage),
  lost: l => l.stage === 'lost',
  all: () => true,
}

handle(async req => {
  const b = await body<{ campaign_id?: string; firm_id?: string }>(req)
  const me = await caller(req, b.firm_id)
  const { data: c } = await me.db.from('campaigns').select('*').eq('id', b.campaign_id ?? '').eq('firm_id', me.firmId).single()
  if (!c) throw new HttpError(404, 'Campaign not found')
  if (c.kind === 'auto') throw new HttpError(400, 'Automatic campaigns send on their trigger, not from here')
  if (c.sent_at) throw new HttpError(409, 'This campaign has already been sent')
  const { data: firm } = await me.db.from('firms').select('*').eq('id', me.firmId).single<FirmRow>()
  const { data: all } = await me.db.from('leads').select('*').eq('firm_id', me.firmId).limit(MAX_AUDIENCE + 1)
  const people = ((all ?? []) as LeadRow[]).filter(AUDIENCE[c.audience] ?? (() => false))
  if (people.length > MAX_AUDIENCE) throw new HttpError(413, `Audiences over ${MAX_AUDIENCE} people need the queued sender`)
  const tags = (c.tags ?? []) as Tag[]
  const channels: ('Email' | 'Text')[] = c.channel === 'Text and Email' ? ['Email', 'Text'] : [c.channel]

  // Work out every recipient first, then send the emails in batches.
  type Row = { lead: LeadRow; channel: 'Email' | 'Text'; status: string; reason?: string; subject?: string; text: string; providerId?: string }
  const rows: Row[] = []
  const stop = (s: string) => (/\bSTOP\b/i.test(s) ? s : s + ' Reply STOP to opt out.')
  for (const lead of people) for (const channel of channels) {
    const text = fill(c.body, lead, firm!, tags)
    if (lead.opted_out) { rows.push({ lead, channel, status: 'skipped', reason: 'Opted out', text }); continue }
    if (channel === 'Email') {
      const blocked = !lead.email ? 'No email address' : emailBlocked(firm!)
      rows.push({ lead, channel, status: blocked ? 'held' : 'queued', reason: blocked ?? undefined, subject: fill(c.subject || c.name, lead, firm!, tags), text })
    } else {
      rows.push({ lead, channel, status: lead.phone ? 'held' : 'skipped', reason: lead.phone ? textBlocked(firm!) : 'No phone number', text: stop(text) })
    }
  }
  const queued = rows.filter(r => r.status === 'queued')
  if (queued.length) {
    const brand = brandOf(firm!)
    const emails: Email[] = queued.map(r => {
      const u = unsubscribeLinks(r.lead)
      const d = renderEmail(brand, r.text, { marketing: true, unsubscribeUrl: u?.page })
      return { from: fromAddress(firm!), to: r.lead.email, subject: r.subject!, text: d.text, html: d.html, headers: u?.headers, tags: [{ name: 'campaign', value: c.id }] }
    })
    try {
      const ids = await sendBatch(emails)
      queued.forEach((r, i) => { r.status = 'delivered'; r.providerId = ids[i] })
    } catch (e) {
      queued.forEach(r => { r.status = 'failed'; r.reason = e instanceof Error ? e.message : 'Send failed' })
    }
  }

  const db = admin()
  const now = new Date().toISOString()
  const chunk = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / 500) }, (_, i) => xs.slice(i * 500, i * 500 + 500))
  for (const part of chunk(rows)) {
    await db.from('campaign_recipients').insert(part.map(r => ({
      firm_id: firm!.id, campaign_id: c.id, lead_id: r.lead.id, name: r.lead.name, channel: r.channel,
      status: r.status === 'delivered' ? 'delivered' : r.status, sent_at: r.status === 'delivered' ? now : null, provider_id: r.providerId ?? null,
    })))
    const sent = part.filter(r => r.status !== 'skipped')
    if (sent.length) await db.from('messages').insert(sent.map(r => ({
      firm_id: firm!.id, lead_id: r.lead.id, campaign_id: c.id, channel: r.channel, provider: r.channel === 'Email' ? 'resend' : null,
      status: r.status === 'delivered' ? 'sent' : r.status, provider_id: r.providerId ?? null, to_address: r.channel === 'Email' ? r.lead.email : r.lead.phone,
      from_address: r.channel === 'Email' && firm!.domain ? fromAddress(firm!) : firm!.phone_number, subject: r.subject ?? null, body: r.text, error: r.reason ?? null, created_by: me.user.id,
    })))
    if (sent.length) await db.from('lead_activities').insert(sent.map(r => ({
      firm_id: firm!.id, lead_id: r.lead.id, type: r.channel === 'Email' ? 'email' : 'text', cls: r.status === 'delivered' ? 'auto' : 'bad', created_by: me.user.id,
      title: r.status === 'delivered' ? `${c.name} ${r.channel === 'Email' ? 'email' : 'text'} sent` : `${c.name} ${r.channel === 'Email' ? 'email' : 'text'} held`,
      text: r.reason ?? (c.kind === 'survey' ? 'Survey.' : 'One-off campaign.'), quote: r.text.slice(0, 140),
    })))
  }
  await db.from('campaigns').update({ sent_at: now, active: true, draft: false }).eq('id', c.id)

  const count = (s: string) => rows.filter(r => r.status === s).length
  const summary = { delivered: count('delivered'), held: count('held'), skipped: count('skipped'), failed: count('failed') }
  await audit({ firmId: firm!.id, actorType: 'user', actorId: me.user.id, action: 'campaign.sent', table: 'campaigns', recordId: c.id, meta: summary })
  return json(summary)
})
