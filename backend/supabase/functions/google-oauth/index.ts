// Google for the portal: Gmail (one inbox for the whole firm) and Google Calendar (each person's own calendar).
//   POST { action: 'start', kind?: 'gmail' | 'calendar' }  (signed in) → { url } for Google's consent screen
//                                                           Gmail needs an admin; anyone can connect their calendar.
//   POST { action: 'disconnect', kind? }                    (signed in) → revokes the token and forgets it
//   POST { action: 'calendar-status' }                      (signed in) → { connected, email }
//   POST { action: 'calendar-events', from, to }            (signed in) → { connected, email, events } (read-only)
//   GET  ?code&state                                        (Google's redirect, no login) → stores tokens, back to Integrations
// The state is signed with GOOGLE_OAUTH_STATE_SECRET so the callback knows which firm, person and kind started it.
// Tokens live in public.google_connections (Gmail) and public.google_calendar_connections (calendars), service role only.
import { type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { HttpError, admin, audit, body, caller, env, json } from '../_shared/core.ts'

type Kind = 'gmail' | 'calendar'
const SCOPES: Record<Kind, string[]> = {
  gmail: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  calendar: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'],
}
/** The scope each kind can't work without. */
const NEEDED: Record<Kind, [string, string]> = {
  gmail: ['https://www.googleapis.com/auth/gmail.send', 'Allow UNIR to send email when Google asks, then try again.'],
  calendar: ['https://www.googleapis.com/auth/calendar.readonly', 'Allow UNIR to see your calendar when Google asks, then try again.'],
}
const STATE_TTL_MS = 10 * 60_000
const MAX_RANGE_MS = 400 * 864e5
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

/** This function's own address: Google sends the person back here. Must match the redirect URI in Google Cloud. */
const callbackUrl = () => Deno.env.get('GOOGLE_REDIRECT_URI') || `${env('SUPABASE_URL')}/functions/v1/google-oauth`
const back = (kind: Kind, status: string, detail?: string) => {
  const u = new URL('/dashboard/integrations', env('SITE_URL'))
  u.searchParams.set(kind === 'calendar' ? 'gcal' : 'gmail', status)
  if (detail) u.searchParams.set('detail', detail.slice(0, 200))
  return Response.redirect(u.toString(), 302)
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
async function hmac(data: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env('GOOGLE_OAUTH_STATE_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))))
}
async function sign(payload: Record<string, unknown>) {
  const data = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  return `${data}.${await hmac(data)}`
}
async function verify(state: string): Promise<{ firm: string; user: string; at: number; kind?: Kind } | null> {
  const [data, sig] = state.split('.')
  if (!data || !sig || (await hmac(data)) !== sig) return null
  const p = JSON.parse(new TextDecoder().decode(fromB64url(data)))
  return Date.now() - p.at > STATE_TTL_MS ? null : p
}
const kindOf = (k: unknown): Kind => (k === 'calendar' ? 'calendar' : 'gmail')
const revoke = (token: string) => fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => {})

async function start(req: Request, firmId: string | undefined, kind: Kind) {
  const me = await caller(req, firmId)
  if (kind === 'gmail' && me.role !== 'admin') throw new HttpError(403, 'Only admins can connect Gmail')
  const state = await sign({ firm: me.firmId, user: me.user.id, kind, at: Date.now(), n: crypto.randomUUID() })
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.search = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: callbackUrl(), response_type: 'code', scope: SCOPES[kind].join(' '),
    access_type: 'offline', prompt: 'consent', state,
  }).toString()
  return json({ url: u.toString() })
}

async function callback(url: URL) {
  const raw = await verify(url.searchParams.get('state') ?? '').catch(() => null)
  const kind = kindOf(raw?.kind)
  if (url.searchParams.get('error')) return back(kind, 'cancelled', url.searchParams.get('error') ?? undefined)
  const code = url.searchParams.get('code')
  if (!code || !raw) return back(kind, 'error', 'The sign-in link expired. Try connecting again.')

  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: callbackUrl(), grant_type: 'authorization_code' }),
  })
  const t = await tok.json()
  if (!tok.ok) return back(kind, 'error', t.error_description ?? t.error ?? 'Google refused the connection')
  if (!t.refresh_token) return back(kind, 'error', 'Google did not return offline access. Remove UNIR from your Google account’s third-party access and try again.')
  const granted = String(t.scope ?? '').split(' ')
  if (!granted.includes(NEEDED[kind][0])) return back(kind, 'error', NEEDED[kind][1])

  const who = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } }).then(r => r.json())
  const db = admin()
  const now = new Date().toISOString()
  const tokens = { email: who.email ?? '', refresh_token: t.refresh_token, access_token: t.access_token, expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(), scopes: granted, connected_at: now }

  if (kind === 'calendar') {
    const { error } = await db.from('google_calendar_connections').upsert({ firm_id: raw.firm, user_id: raw.user, ...tokens }, { onConflict: 'firm_id,user_id' })
    if (error) return back(kind, 'error', error.message)
  } else {
    const { error } = await db.from('google_connections').upsert({ firm_id: raw.firm, provider: 'gmail', connected_by: raw.user, ...tokens }, { onConflict: 'firm_id,provider' })
    if (error) return back(kind, 'error', error.message)
    await db.from('integrations').upsert({ firm_id: raw.firm, provider: 'gmail', enabled: true, settings: { email: who.email ?? '' }, connected_at: now }, { onConflict: 'firm_id,provider' })
  }
  await audit({ firmId: raw.firm, actorType: 'user', actorId: raw.user, action: `integration.${kind === 'calendar' ? 'gcal' : 'gmail'}.connected`, meta: { email: who.email } })
  return back(kind, 'connected', who.email)
}

async function disconnect(req: Request, firmId: string | undefined, kind: Kind) {
  const me = await caller(req, firmId)
  const db = admin()
  if (kind === 'calendar') {
    const { data: c } = await db.from('google_calendar_connections').select('refresh_token, email').eq('firm_id', me.firmId).eq('user_id', me.user.id).maybeSingle()
    if (c?.refresh_token) await revoke(c.refresh_token)
    await db.from('google_calendar_connections').delete().eq('firm_id', me.firmId).eq('user_id', me.user.id)
    await audit({ firmId: me.firmId, actorType: 'user', actorId: me.user.id, action: 'integration.gcal.disconnected', meta: { email: c?.email } })
    return json({ ok: true })
  }
  if (me.role !== 'admin') throw new HttpError(403, 'Only admins can disconnect Gmail')
  const { data: c } = await db.from('google_connections').select('refresh_token, email').eq('firm_id', me.firmId).eq('provider', 'gmail').maybeSingle()
  if (c?.refresh_token) await revoke(c.refresh_token)
  await db.from('google_connections').delete().eq('firm_id', me.firmId).eq('provider', 'gmail')
  await db.from('integrations').upsert({ firm_id: me.firmId, provider: 'gmail', enabled: false, settings: {}, connected_at: null }, { onConflict: 'firm_id,provider' })
  await audit({ firmId: me.firmId, actorType: 'user', actorId: me.user.id, action: 'integration.gmail.disconnected', meta: { email: c?.email } })
  return json({ ok: true })
}

type CalRow = { email: string; refresh_token: string; access_token: string | null; expires_at: string | null }

/** A working access token for the person's calendar, refreshed when it is about to expire. Null when access was withdrawn. */
async function calendarToken(db: SupabaseClient, firmId: string, userId: string, c: CalRow): Promise<string | null> {
  if (c.access_token && c.expires_at && Date.parse(c.expires_at) > Date.now() + 60_000) return c.access_token
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: c.refresh_token, grant_type: 'refresh_token' }),
  })
  const t = await r.json()
  if (!r.ok) {
    // Access was removed in the Google account: forget the connection so the person can connect again.
    if (t.error === 'invalid_grant') { await db.from('google_calendar_connections').delete().eq('firm_id', firmId).eq('user_id', userId); return null }
    throw new HttpError(502, `Google: ${t.error_description ?? t.error ?? r.statusText}`)
  }
  await db.from('google_calendar_connections').update({ access_token: t.access_token, expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString() }).eq('firm_id', firmId).eq('user_id', userId)
  return t.access_token
}

async function calendar(req: Request, b: { firm_id?: string; from?: string; to?: string }, withEvents: boolean) {
  const me = await caller(req, b.firm_id)
  const db = admin()
  const { data: c } = await db.from('google_calendar_connections').select('email, refresh_token, access_token, expires_at').eq('firm_id', me.firmId).eq('user_id', me.user.id).maybeSingle()
  if (!c) return json({ connected: false })
  if (!withEvents) return json({ connected: true, email: c.email })

  const from = Date.parse(b.from ?? ''), to = Date.parse(b.to ?? '')
  if (!from || !to || to <= from || to - from > MAX_RANGE_MS) throw new HttpError(400, 'Send from and to as dates, at most 400 days apart')
  const token = await calendarToken(db, me.firmId, me.user.id, c as CalRow)
  if (!token) return json({ connected: false, reconnect: true })

  const events: unknown[] = []
  let page: string | undefined
  do {
    const u = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    u.search = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(page ? { pageToken: page } : {}) }).toString()
    const r = await fetch(u, { headers: { authorization: `Bearer ${token}` } })
    const d = await r.json()
    if (!r.ok) throw new HttpError(502, `Google Calendar: ${d?.error?.message ?? r.statusText}`)
    for (const e of d.items ?? []) {
      if (e.status === 'cancelled') continue
      const allDay = !e.start?.dateTime
      events.push({
        id: e.id, title: e.summary || '(No title)', description: e.description ?? '', location: e.location ?? '', link: e.htmlLink ?? '',
        start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, allDay,
      })
    }
    page = d.nextPageToken
  } while (page && events.length < 1000)
  return json({ connected: true, email: c.email, events })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (req.method === 'GET') return await callback(new URL(req.url))
    if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
    const b = await body<{ action?: string; kind?: string; firm_id?: string; from?: string; to?: string }>(req)
    if (b.action === 'start') return await start(req, b.firm_id, kindOf(b.kind))
    if (b.action === 'disconnect') return await disconnect(req, b.firm_id, kindOf(b.kind))
    if (b.action === 'calendar-status') return await calendar(req, b, false)
    if (b.action === 'calendar-events') return await calendar(req, b, true)
    throw new HttpError(400, 'Unknown action')
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status >= 500) console.error(e)
    if (req.method === 'GET') return back('gmail', 'error', e instanceof Error ? e.message : 'Something went wrong')
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, status)
  }
})
