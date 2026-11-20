// Live mode: keeps the portal's tables (see mockServer.ts) in step with the signed-in firm's data in Supabase.
//
// On sign-in it loads everything for the person's firm. After every change the portal makes, it works out which rows
// changed (by comparing them with what was last saved) and writes just those, so all the existing business rules keep
// working unchanged. Row level security on the server decides what this person may read and write.
// Sending (email, campaigns) and Chat go through the Edge Functions, never through the browser.
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import * as seed from './mockData'
import { config } from './mockData'
import { emptyTables, fill, hooks, store, type Tables } from './mockServer'
import type { Activity, Bot, BotRun, Campaign, CampaignFolder, ChatConversation, ChatMessage, FirmEvent, Lead, MessageTemplate, PortalDocument, Recipient, Service, Task } from './types'
import { toast } from '../shared/toast'
import { fileHooks, setFileUrl } from '../modules/documents/fileStore'

type Row = Record<string, unknown>
// deno-lint-ignore no-explicit-any
type Any = any

export interface Member { id: string; name: string; role: 'admin' | 'member'; title: string; email?: string; invitedAt?: number; status?: 'pending' | 'accepted' }
export type RemoteState = 'idle' | 'loading' | 'ready' | 'no-firm' | 'error'

let state: RemoteState = 'idle'
let message = ''
const listeners = new Set<() => void>()
const setState = (s: RemoteState, m = '') => { state = s; message = m; listeners.forEach(l => l()) }

export const remote = {
  firmId: '',
  userId: '',
  email: '',
  members: [] as Member[],
  state: () => state,
  message: () => message,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
}

const sb = () => { if (!supabase) throw new Error('Supabase is not configured'); return supabase }
const ms = (s: unknown) => (s ? Date.parse(String(s)) : undefined)
const iso = (n?: number | null) => (n ? new Date(n).toISOString() : null)
const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'Something went wrong')
const nameOf = (id: unknown) => remote.members.find(m => m.id === id)?.name ?? ''
const idOf = (name?: string) => remote.members.find(m => m.name === name)?.id ?? null
const isUuid = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s)

/** Every row of a table for this firm (pages past PostgREST's 1,000-row limit). */
async function all(table: string, order = 'created_at', ascending = false, filter: [string, string] = ['firm_id', remote.firmId]): Promise<Any[]> {
  const out: Any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb().from(table).select('*').eq(filter[0], filter[1]).order(order, { ascending }).range(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}
const group = (rows: Any[], key: string) => rows.reduce<Record<string, Any[]>>((m, r) => ((m[r[key]] ||= []).push(r), m), {})

/** Each teammate's email and whether they've accepted their invite. Empty if the server doesn't have it yet. */
async function memberStatuses(fid: string): Promise<Record<string, Any>> {
  const { data, error } = await sb().rpc('firm_member_status', { f: fid })
  if (error) { console.warn('Invite status unavailable:', error.message); return {} }
  return Object.fromEntries((data ?? []).map((r: Any) => [r.user_id, r]))
}

/* ---------- server rows → the portal's shapes ---------- */

async function fetchAll(): Promise<Tables> {
  const fid = remote.firmId
  const [firms, members, statuses] = await Promise.all([all('firms', 'created_at', true, ['id', fid]), all('firm_members'), memberStatuses(fid)])
  remote.members = members.map(m => {
    const s = statuses[m.user_id]
    return {
      id: m.user_id, role: m.role, title: m.title ?? '',
      name: m.full_name || (m.user_id === remote.userId ? remote.email : s?.email || 'Teammate'),
      email: s?.email ?? undefined, invitedAt: ms(s?.invited_at), status: s ? (s.accepted ? 'accepted' : 'pending') : undefined,
    }
  })
  const [leads, acts, lsvc, packets, tasks, events, services, docs, folders, camps, recips, templates, integ, bots, convs] = await Promise.all([
    all('leads'), all('lead_activities', 'at', true), all('lead_services', 'lead_id'), all('engagement_packets', 'sent_at'),
    all('tasks', 'due_at', true), all('firm_events', 'starts_at', true), all('services'), all('documents', 'updated_at'),
    all('campaign_folders', 'created_at', true), all('campaigns', 'created_at'), all('campaign_recipients', 'sent_at'), all('message_templates', 'updated_at'),
    all('integrations', 'provider'), all('bots', 'updated_at'), all('conversations', 'updated_at', false, ['user_id', remote.userId]),
  ])
  const chatRows = convs.length ? (await sb().from('chat_messages').select('*').in('conversation_id', convs.map(c => c.id)).order('created_at')).data ?? [] : []

  const f = firms[0]
  // Owners and practice areas come from this firm, not the sample firm.
  config.owners.splice(0, config.owners.length, ...remote.members.map(m => m.name))
  if (f?.practice_areas?.length) config.practiceAreas.splice(0, config.practiceAreas.length, ...f.practice_areas)

  const actsBy = group(acts, 'lead_id'), svcBy = group(lsvc, 'lead_id'), packBy = group(packets, 'lead_id'), recBy = group(recips, 'campaign_id'), msgBy = group(chatRows, 'conversation_id')
  const docPaths: [string, string][] = []

  const t: Tables = {
    ...emptyTables(),
    firm: {
      name: f?.name ?? '', domain: f?.domain ?? '', number: f?.phone_number ?? '', domainStatus: f?.domain_status ?? 'unverified', textStatus: f?.text_status ?? 'unregistered',
      domainRecords: f?.domain_records ?? [], domainCheckedAt: ms(f?.domain_checked_at),
      brand: { logoUrl: f?.email_logo_url ?? undefined, color: f?.email_brand_color ?? '#0f2347', signature: f?.email_signature ?? '', footer: f?.email_footer ?? '' },
    },
    leads: leads.map((r): Lead => {
      const p = packBy[r.id]?.[0]
      return {
        id: r.id, name: r.name, email: r.email, phone: r.phone, matter: r.matter, practice: r.practice, source: r.source, value: Number(r.value),
        stage: r.stage, owner: nameOf(r.owner_id), created: ms(r.created_at)!, lostReason: r.lost_reason ?? null,
        optedOut: r.opted_out || undefined, notes: r.notes || undefined,
        serviceIds: svcBy[r.id]?.map(x => x.service_id),
        activities: (actsBy[r.id] ?? []).map((a): Activity => ({ id: a.id, t: ms(a.at)!, type: a.type, cls: a.cls, title: a.title, text: a.text ?? undefined, quote: a.quote ?? undefined })),
        doc: p ? { id: p.id, status: p.status === 'signed' ? 'signed' : 'sent', sent: ms(p.sent_at)!, signed: ms(p.signed_at), by: p.signed_by ?? undefined, items: p.items ?? [] } : null,
      }
    }),
    tasks: tasks.map((r): Task => ({
      id: r.id, type: r.type, title: r.title, dueAt: ms(r.due_at)!, done: r.done, completedAt: ms(r.completed_at), assignedTo: nameOf(r.assigned_to),
      leadId: r.lead_id ?? undefined, notes: r.notes || undefined, auto: r.auto || undefined,
    })),
    events: events.map((r): FirmEvent => ({ id: r.id, t: ms(r.starts_at)!, dur: r.duration_min, title: r.title, who: r.who })),
    services: services.map((r): Service => ({
      id: r.id, name: r.name, practice: r.practice, description: r.description, pricingModel: r.pricing_model, price: Number(r.price), retainer: Number(r.retainer),
      active: r.active, createdAt: ms(r.created_at)!, updatedAt: ms(r.updated_at)!,
    })),
    documents: docs.map((r): PortalDocument => {
      if (r.file_path) docPaths.push([r.id, r.file_path])
      return {
        id: r.id, name: r.name, category: r.category, description: r.description, fields: r.fields ?? [], active: r.active,
        file: r.file_path ? { name: r.file_name ?? '', size: Number(r.file_size ?? 0), type: r.file_type ?? '', uploadedAt: ms(r.uploaded_at) ?? ms(r.updated_at)! } : null,
        createdAt: ms(r.created_at)!, updatedAt: ms(r.updated_at)!, updatedBy: nameOf(r.updated_by),
      }
    }),
    campaignFolders: folders.map((r): CampaignFolder => ({ id: r.id, name: r.name, createdAt: ms(r.created_at)! })),
    campaigns: camps.map((r): Campaign => {
      const rec = (recBy[r.id] ?? []).map((x): Recipient => ({
        id: x.lead_id ?? x.id, name: x.name, channel: x.channel, status: x.status === 'delivered' || x.status === 'skipped' ? x.status : 'held',
        at: ms(x.sent_at), opened: x.opened, replied: x.replied, score: x.score ?? undefined,
      }))
      return {
        id: r.id, kind: r.kind, metric: r.metric ?? undefined, tags: r.tags?.length ? r.tags : undefined, folderId: r.folder_id ?? undefined, name: r.name,
        channel: r.channel, steps: r.steps, sent: rec.filter(x => x.status === 'delivered').length, subject: r.subject, body: r.body, recipients: rec,
        trigger: r.trigger ?? undefined, active: r.active, draft: r.draft, audience: r.audience ?? undefined, sentAt: ms(r.sent_at),
      }
    }),
    templates: templates.map((r): MessageTemplate => ({
      id: r.id, name: r.name, channel: r.channel, subject: r.subject ?? undefined, body: r.body, tags: r.tags?.length ? r.tags : undefined,
      createdAt: ms(r.created_at)!, updatedAt: ms(r.updated_at)!, updatedBy: nameOf(r.updated_by),
    })),
    integrations: seed.integrations().map(i => { const r = integ.find(x => x.provider === i.id); return { ...i, on: r?.enabled ?? false, account: r?.enabled ? r?.settings?.email || undefined : undefined } }),
    bots: bots.map((r): Bot => ({
      id: r.id, name: r.name, description: r.description, instructions: r.instructions, model: r.model, tools: r.tools, actions: r.actions, external: r.external,
      active: r.active, runs: r.runs, createdAt: ms(r.created_at)!, updatedAt: ms(r.updated_at)!, updatedBy: nameOf(r.updated_by),
      lastRunAt: ms(r.last_run_at),
      schedule: { enabled: r.schedule_enabled, days: r.schedule_days ?? [], time: String(r.schedule_time ?? '08:00').slice(0, 5), tz: r.schedule_tz, to: (r.deliver_to ?? []).map(nameOf).filter(Boolean) },
    })),
    conversations: convs.map((r): ChatConversation => ({
      id: r.id, title: r.title, botId: r.bot_id, createdAt: ms(r.created_at)!, updatedAt: ms(r.updated_at)!, unread: r.unread || undefined,
      messages: (msgBy[r.id] ?? []).map(toMessage),
    })),
  }

  // Short-lived download links for the document library's files.
  if (docPaths.length) {
    const { data } = await sb().storage.from('documents').createSignedUrls(docPaths.map(d => d[1]), 3600)
    data?.forEach((x, i) => { if (x.signedUrl) setFileUrl(docPaths[i][0], x.signedUrl) })
  }
  return t
}

const toMessage = (m: Any): ChatMessage => ({
  id: m.id, role: m.role, text: m.text, at: ms(m.created_at)!, steps: m.steps?.length ? m.steps : undefined, action: m.action ?? undefined,
})

/* ---------- the portal's shapes → server rows ---------- */

/** The tables written from the browser, parents first, and each one's key. */
const TABLES: [string, string][] = [
  ['firms', 'id'], ['services', 'id'], ['campaign_folders', 'id'], ['leads', 'id'], ['lead_services', 'lead_id,service_id'], ['lead_activities', 'id'],
  ['engagement_packets', 'id'], ['tasks', 'id'], ['firm_events', 'id'], ['documents', 'id'], ['campaigns', 'id'], ['message_templates', 'id'],
  ['integrations', 'firm_id,provider'], ['bots', 'id'],
]
type Rows = Record<string, Map<string, string>>

function rowsOf(t: Tables): Rows {
  const fid = remote.firmId
  const out: Record<string, Row[]> = Object.fromEntries(TABLES.map(([n]) => [n, []]))
  const svcIds = new Set(t.services.map(s => s.id))
  out.firms.push({
    // The domain, its status and texting are set by the server (email-domain, MGC), never pushed from here.
    id: fid, name: t.firm.name,
    email_logo_url: t.firm.brand?.logoUrl || null, email_brand_color: t.firm.brand?.color || '#0f2347', email_signature: t.firm.brand?.signature ?? '', email_footer: t.firm.brand?.footer ?? '',
  })
  for (const s of t.services) out.services.push({ id: s.id, firm_id: fid, name: s.name, practice: s.practice, description: s.description, pricing_model: s.pricingModel, price: s.price, retainer: s.retainer, active: s.active })
  for (const f of t.campaignFolders) out.campaign_folders.push({ id: f.id, firm_id: fid, name: f.name })
  for (const l of t.leads) {
    out.leads.push({
      id: l.id, firm_id: fid, name: l.name, email: l.email ?? '', phone: l.phone ?? '', matter: l.matter ?? '', practice: l.practice ?? '', source: l.source,
      value: l.value ?? 0, stage: l.stage, owner_id: idOf(l.owner), lost_reason: l.lostReason ?? null, opted_out: !!l.optedOut, notes: l.notes ?? '', created_at: iso(l.created),
    })
    for (const sid of l.serviceIds ?? []) if (svcIds.has(sid)) out.lead_services.push({ lead_id: l.id, service_id: sid, firm_id: fid })
    for (const a of l.activities) {
      a.id ??= crypto.randomUUID()
      out.lead_activities.push({ id: a.id, firm_id: fid, lead_id: l.id, at: iso(a.t), type: a.type, cls: a.cls ?? '', title: a.title, text: a.text ?? null, quote: a.quote ?? null })
    }
    if (l.doc) {
      l.doc.id ??= crypto.randomUUID()
      out.engagement_packets.push({ id: l.doc.id, firm_id: fid, lead_id: l.id, status: l.doc.status, sent_at: iso(l.doc.sent), signed_at: iso(l.doc.signed), signed_by: l.doc.by ?? null, items: l.doc.items ?? [] })
    }
  }
  for (const a of t.tasks) out.tasks.push({
    id: a.id, firm_id: fid, type: a.type, title: a.title, due_at: iso(a.dueAt), done: a.done, completed_at: iso(a.completedAt), assigned_to: idOf(a.assignedTo),
    lead_id: a.leadId ?? null, notes: a.notes ?? '', auto: !!a.auto,
  })
  for (const e of t.events) out.firm_events.push({ id: e.id, firm_id: fid, starts_at: iso(e.t), duration_min: e.dur, title: e.title, who: e.who })
  for (const d of t.documents) out.documents.push({
    id: d.id, firm_id: fid, name: d.name, category: d.category, description: d.description, fields: d.fields, active: d.active && !!d.file,
    file_path: d.file ? `${fid}/${d.id}/${d.file.name}` : null, file_name: d.file?.name ?? null, file_size: d.file?.size ?? null, file_type: d.file?.type ?? null,
    uploaded_at: iso(d.file?.uploadedAt),
  })
  for (const c of t.campaigns) out.campaigns.push({
    id: c.id, firm_id: fid, folder_id: c.folderId ?? null, kind: c.kind, metric: c.kind === 'survey' ? c.metric ?? 'nps' : null, name: c.name, channel: c.channel,
    subject: c.subject ?? '', body: c.body, tags: c.tags ?? [], trigger: c.trigger ?? null, audience: c.kind === 'auto' ? c.audience ?? null : c.audience ?? 'open',
    active: !!c.active, draft: !!c.draft, steps: c.steps ?? 1,
  })
  for (const x of t.templates) out.message_templates.push({ id: x.id, firm_id: fid, name: x.name, channel: x.channel, subject: x.subject ?? null, body: x.body, tags: x.tags ?? [] })
  for (const i of t.integrations) out.integrations.push({ firm_id: fid, provider: i.id, enabled: i.on })
  for (const b of t.bots) out.bots.push({
    id: b.id, firm_id: fid, name: b.name, description: b.description, instructions: b.instructions, model: b.model, tools: b.tools, actions: b.actions, external: b.external, active: b.active,
    ...(b.schedule ? {
      schedule_enabled: b.schedule.enabled, schedule_days: b.schedule.days, schedule_time: b.schedule.time, schedule_tz: b.schedule.tz,
      deliver_to: b.schedule.to.map(idOf).filter((x): x is string => !!x),
    } : {}),
  })
  return Object.fromEntries(TABLES.map(([n, key]) => [n, new Map(out[n].map(r => [key.split(',').map(k => String(r[k])).join('|'), JSON.stringify(r)]))]))
}

/** Writes what changed between two snapshots: new and changed rows (parents first), then removed rows (children first). */
async function push(prev: Rows, cur: Rows) {
  for (const [table, key] of TABLES) {
    const changed = [...cur[table]].filter(([k, v]) => prev[table].get(k) !== v).map(([, v]) => JSON.parse(v))
    if (!changed.length) continue
    if (table === 'firms') {
      const { id, ...patch } = changed[0]
      const { error } = await sb().from('firms').update(patch).eq('id', id)
      if (error) throw error
      continue
    }
    if (table === 'integrations' && !remote.members.some(m => m.id === remote.userId && m.role === 'admin')) {
      toast('Only admins can change integrations'); continue
    }
    for (let i = 0; i < changed.length; i += 500) {
      const { error } = await sb().from(table).upsert(changed.slice(i, i + 500), { onConflict: key })
      if (error) throw error
    }
  }
  for (const [table, key] of [...TABLES].reverse()) {
    const gone = [...prev[table].keys()].filter(k => !cur[table].has(k))
    if (!gone.length || table === 'firms') continue
    if (key === 'id') {
      for (let i = 0; i < gone.length; i += 200) {
        const { error } = await sb().from(table).delete().in('id', gone.slice(i, i + 200))
        if (error) throw error
      }
    } else {
      for (const k of gone) {
        const parts = k.split('|'), cols = key.split(',')
        const { error } = await sb().from(table).delete().match(Object.fromEntries(cols.map((c, i) => [c, parts[i]])))
        if (error) throw error
      }
    }
  }
}

/* ---------- saving ---------- */

let saved: Rows | null = null
let dirty = false
let running: Promise<void> | null = null
let timer: ReturnType<typeof setTimeout> | undefined

function schedule() {
  if (!saved || state !== 'ready') return
  dirty = true
  clearTimeout(timer)
  timer = setTimeout(() => { void save() }, 250)
}

async function save(): Promise<void> {
  while (running) await running
  if (!dirty || !saved) return
  dirty = false
  const cur = rowsOf(store.get())
  const prev = saved
  running = push(prev, cur)
    .then(() => { saved = cur })
    .catch(async e => { console.error(e); toast('Couldn’t save that change', errText(e)); await reload() })
    .finally(() => { running = null })
  await running
}

/** Waits until every change so far is saved. */
export async function flush() { clearTimeout(timer); await save(); while (running) await running }

/** Loads the firm's data again (after the server changed it, or to pick up teammates' changes). */
export async function reload() {
  if (!remote.firmId) return
  await flush()
  try {
    const t = await fetchAll()
    t.sending = store.get().sending
    saved = rowsOf(t)
    store.replace(t)
  } catch (e) { toast('Couldn’t load your data', errText(e)) }
}

/* ---------- server functions ---------- */

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().functions.invoke(name, { body })
  if (error) {
    let msg = error.message
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* keep the generic message */ }
    throw new Error(msg)
  }
  return data as T
}

let queue: Promise<unknown> = Promise.resolve()
const later = (fn: () => Promise<void>) => { queue = queue.then(fn).catch(e => toast('Something went wrong', errText(e))) }

// An automatic campaign's email for one lead: sent by the server from the firm's domain, recorded on the timeline.
hooks.autoEmail = (c, l) => later(async () => {
  if (!l.email || l.optedOut) return // nothing to send to
  await flush()
  await invoke('send-email', { lead_id: l.id, subject: fill(c.subject || c.name, l, c.tags), body: fill(c.body, l, c.tags) })
  await reload()
})
// A one-off campaign or survey: sent by the server to its audience.
hooks.broadcast = c => later(async () => {
  await flush()
  const t = store.get()
  t.sending = { id: c.id, total: 1, done: 0 }; store.replace(t)
  try {
    const r = await invoke<{ delivered: number; held: number; skipped: number; failed: number }>('send-campaign', { campaign_id: c.id })
    toast(`${c.name} sent`, [`${r.delivered} delivered`, r.held ? `${r.held} held` : '', r.skipped ? `${r.skipped} skipped` : '', r.failed ? `${r.failed} failed` : ''].filter(Boolean).join(', '))
  } finally {
    store.get().sending = null
    await reload()
  }
})
hooks.reload = () => { void reload().then(() => toast('Data reloaded')) }

// Document files go to the firm's private bucket, at <firm>/<document>/<file name>.
fileHooks.upload = (docId, file) => later(async () => {
  const { error } = await sb().storage.from('documents').upload(`${remote.firmId}/${docId}/${file.name}`, file, { upsert: true, contentType: file.type || undefined })
  if (error) throw error
})

/* ---------- firm settings ---------- */

/** Is the signed-in person an admin of their firm? (Only admins can change firm settings.) */
export const isAdmin = () => remote.members.some(m => m.id === remote.userId && m.role === 'admin')

/** Uploads a logo to the public branding bucket and returns its link. */
export async function uploadLogo(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${remote.firmId}/logo-${Date.now()}.${ext}`
  const { error } = await sb().storage.from('branding').upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (error) throw error
  return sb().storage.from('branding').getPublicUrl(path).data.publicUrl
}

/** Invites someone to the firm (admins only, checked again on the server). */
export async function inviteMember(email: string, name: string, role: 'admin' | 'member') {
  const r = await invoke<{ invited: boolean }>('invite-member', { email, full_name: name, role })
  await reload()
  return r
}

/** Adds the firm's email domain (admins only): the server adds it to Resend and saves the DNS records to show. */
export async function addDomain(domain: string) {
  await invoke('email-domain', { action: 'add', domain })
  await reload()
}

/** Asks Resend to look for the DNS records now. Returns the firm's new domain status. */
export async function checkDomain(): Promise<string> {
  const r = await invoke<{ status: string }>('email-domain', { action: 'check' })
  await reload()
  return r.status
}

/* ---------- Gmail (Google OAuth) ---------- */

/** Sends the browser to Google's consent screen; Google comes back to Integrations with ?gmail=connected. */
export async function gmailConnect() {
  await flush()
  const { url } = await invoke<{ url: string }>('google-oauth', { action: 'start' })
  window.location.assign(url)
}

/** Revokes the firm's Gmail access and switches the integration off. */
export async function gmailDisconnect() {
  await invoke('google-oauth', { action: 'disconnect' })
  await reload()
  toast('Gmail disconnected')
}

/* ---------- agents running on their own ---------- */

/** An agent's 20 most recent runs. */
export async function botRuns(botId: string): Promise<BotRun[]> {
  const { data, error } = await sb().from('bot_runs').select('*').eq('bot_id', botId).order('at', { ascending: false }).limit(20)
  if (error) throw error
  return (data ?? []).map((r: Any): BotRun => ({
    id: r.id, at: ms(r.at)!, trigger: r.trigger, status: r.status, output: r.output, recipients: r.recipients ?? [], emailStatus: r.email_status, error: r.error ?? undefined,
  }))
}

/** The agent sets itself up: Claude drafts its name, instructions and permissions from a description. Nothing is saved. */
export async function agentSetup(description: string) {
  const r = await invoke<{ draft: Any }>('agent-setup', { description })
  return r.draft
}

/** Runs an agent once, now (its settings must be saved first, which flush does). */
export async function runAgent(botId: string) {
  await flush()
  const r = await invoke<{ run: Any }>('run-agent', { bot_id: botId })
  const run = r.run
  if (run?.status === 'failed') toast('The agent couldn’t finish', run.error ?? undefined)
  else if (run?.email_status === 'sent') toast('Agent ran and emailed', `Sent to ${run.recipients.length} ${run.recipients.length === 1 ? 'person' : 'people'}`)
  else if (run?.email_status === 'held') toast('Agent ran, email held', run.error ?? undefined)
  else if (run?.email_status === 'failed') toast('Agent ran, email failed', run.error ?? undefined)
  else toast('Agent ran', 'No one is set to get the result by email')
  await reload()
}

/* ---------- chat ---------- */

const touch = () => store.replace(store.get())
const conv = (id: string) => store.get().conversations.find(c => c.id === id)

async function reloadConversation(id: string) {
  const { data } = await sb().from('chat_messages').select('*').eq('conversation_id', id).order('created_at')
  const c = conv(id)
  if (c) { c.messages = (data ?? []).map(toMessage); c.pending = false; c.updatedAt = Date.now(); c.unread = true; touch() }
}

export const liveChat = {
  async create(botId: string | null): Promise<ChatConversation> {
    await flush() // the agent may have just been made: it has to be saved before a conversation can point at it
    const id = crypto.randomUUID(), now = Date.now()
    const { error } = await sb().from('conversations').insert({ id, firm_id: remote.firmId, user_id: remote.userId, bot_id: botId, title: 'New chat' })
    if (error) throw error
    const c: ChatConversation = { id, title: 'New chat', botId, createdAt: now, updatedAt: now, messages: [] }
    store.get().conversations.unshift(c); touch()
    return structuredClone(c)
  },
  async send(id: string, text: string) {
    const c = conv(id), msg = text.trim()
    if (!c || !msg || c.pending) return
    c.messages.push({ id: 'pending-' + Date.now(), role: 'user', text: msg, at: Date.now() })
    if (c.title === 'New chat') {
      c.title = msg.length > 44 ? msg.slice(0, 44) + '…' : msg
      void sb().from('conversations').update({ title: c.title }).eq('id', id)
    }
    c.pending = true; touch()
    try { await invoke('chat', { conversation_id: id, message: msg }) } catch (e) { toast('The assistant couldn’t answer', errText(e)) }
    await reloadConversation(id)
  },
  async decide(id: string, messageId: string, decision: 'approve' | 'decline') {
    try { await invoke('chat-action', { message_id: messageId, decision }) } catch (e) { toast('Couldn’t do that', errText(e)) }
    await reloadConversation(id)
    if (decision === 'approve') await reload()
  },
  markRead(id: string) { const c = conv(id); if (c?.unread) { c.unread = false; touch(); void sb().from('conversations').update({ unread: false }).eq('id', id) } },
  async setBot(id: string, botId: string | null) { const c = conv(id); if (c) { c.botId = botId; touch() } await sb().from('conversations').update({ bot_id: botId }).eq('id', id) },
  async remove(id: string) { const t = store.get(); t.conversations = t.conversations.filter(c => c.id !== id); touch(); await sb().from('conversations').delete().eq('id', id) },
}

/* ---------- starting and stopping ---------- */

let subscribed = false
let lastPull = 0

/** Called when someone signs in: finds their firm and loads its data. */
export async function start(session: Session) {
  if (remote.userId === session.user.id && (state === 'ready' || state === 'loading')) return
  remote.userId = session.user.id
  remote.email = session.user.email ?? ''
  setState('loading')
  try {
    const { data, error } = await sb().from('firm_members').select('firm_id').eq('user_id', session.user.id).limit(1)
    if (error) throw error
    if (!data?.length) { setState('no-firm'); return }
    remote.firmId = data[0].firm_id
    const t = await fetchAll()
    saved = rowsOf(t)
    store.replace(t)
    if (!subscribed) {
      subscribed = true
      store.subscribe(schedule)
      // Pick up teammates' changes when coming back to the tab (at most every 20 seconds).
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && state === 'ready' && !dirty && !running && Date.now() - lastPull > 20_000) { lastPull = Date.now(); void reload() }
      })
    }
    setState('ready')
  } catch (e) {
    setState('error', errText(e))
  }
}

/** Called on sign-out: forgets the firm's data in this tab. */
export function stop() {
  clearTimeout(timer)
  saved = null; dirty = false
  remote.firmId = ''; remote.userId = ''; remote.members = []
  store.replace(emptyTables())
  setState('idle')
}
