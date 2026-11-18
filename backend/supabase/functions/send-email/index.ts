// Emails one lead from the firm's own domain through Resend, and records it on the lead's timeline.
// If the firm's domain isn't verified yet, the email is kept as "held" instead of sent.
// POST { lead_id, subject, body, template_id?, firm_id? }   (body may use {first}, {matter}, {firm} and the template's inputs)
import { HttpError, admin, audit, body, caller, handle, json } from '../_shared/core.ts'
import { type FirmRow, type LeadRow, type Tag, brandOf, emailBlocked, fill, fromAddress, renderEmail, sendEmail } from '../_shared/messaging.ts'

handle(async req => {
  const b = await body<{ lead_id?: string; subject?: string; body?: string; template_id?: string; firm_id?: string }>(req)
  const me = await caller(req, b.firm_id)
  if (!b.lead_id || !b.body?.trim()) throw new HttpError(400, 'Send lead_id and body')

  // Read as the caller, so row level security proves the lead is in their firm.
  const { data: lead } = await me.db.from('leads').select('*').eq('id', b.lead_id).eq('firm_id', me.firmId).single<LeadRow>()
  if (!lead) throw new HttpError(404, 'Lead not found')
  if (!lead.email) throw new HttpError(400, `${lead.name} has no email address`)
  if (lead.opted_out) throw new HttpError(409, `${lead.name} has opted out of messages`)
  const { data: firm } = await me.db.from('firms').select('*').eq('id', me.firmId).single<FirmRow>()
  if (!firm) throw new HttpError(404, 'Firm not found')

  let tags: Tag[] = []
  if (b.template_id) {
    const { data: t } = await me.db.from('message_templates').select('tags').eq('id', b.template_id).single()
    tags = (t?.tags as Tag[]) ?? []
  }
  const subject = fill(b.subject?.trim() || `A message from ${firm.name}`, lead, firm, tags, { owner: me.name })
  const text = fill(b.body, lead, firm, tags, { owner: me.name })

  const blocked = emailBlocked(firm)
  let providerId: string | null = null, error: string | null = blocked
  if (!blocked) {
    const designed = renderEmail(brandOf(firm), text)
    try { providerId = await sendEmail({ from: fromAddress(firm), to: lead.email, subject, text: designed.text, html: designed.html, tags: [{ name: 'firm', value: firm.id }] }) }
    catch (e) { error = e instanceof Error ? e.message : 'Send failed' }
  }
  const status = providerId ? 'sent' : blocked ? 'held' : 'failed'

  const db = admin()
  const { data: msg } = await db.from('messages').insert({
    firm_id: firm.id, lead_id: lead.id, channel: 'Email', status, provider: 'resend', provider_id: providerId,
    to_address: lead.email, from_address: firm.domain ? fromAddress(firm) : null, subject, body: text, error, created_by: me.user.id,
  }).select('id').single()
  await db.from('lead_activities').insert({
    firm_id: firm.id, lead_id: lead.id, type: 'email', cls: providerId ? '' : 'bad', created_by: me.user.id,
    title: providerId ? `Email sent by ${me.name}` : 'Email held', text: providerId ? `From intake@${firm.domain}.` : error, quote: text.slice(0, 140),
  })
  await audit({ firmId: firm.id, actorType: 'user', actorId: me.user.id, action: `email.${status}`, table: 'messages', recordId: msg?.id, meta: { lead_id: lead.id, to: lead.email } })

  if (status === 'failed') throw new HttpError(502, error ?? 'Send failed')
  return json({ status, message_id: msg?.id, reason: blocked })
})
