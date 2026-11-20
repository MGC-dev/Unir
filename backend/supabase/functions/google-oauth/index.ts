// Gmail integration through Google OAuth.
//   POST { action: 'start', firm_id? }       (admin, signed in) → { url } to send the browser to Google's consent screen
//   POST { action: 'disconnect', firm_id? }  (admin, signed in) → revokes the token and switches Gmail off
//   GET  ?code&state                          (Google's redirect, no login) → stores the tokens, back to Integrations
// The state is signed with GOOGLE_OAUTH_STATE_SECRET so the callback knows which firm and person started it.
// Tokens live in public.google_connections (service role only); public.integrations shows the firm it is connected.
import { HttpError, admin, audit, body, caller, env, json } from '../_shared/core.ts'

const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
]
const STATE_TTL_MS = 10 * 60_000
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

/** This function's own address: Google sends the person back here. Must match the redirect URI in Google Cloud. */
const callbackUrl = () => Deno.env.get('GOOGLE_REDIRECT_URI') || `${env('SUPABASE_URL')}/functions/v1/google-oauth`
const back = (status: string, detail?: string) => {
  const u = new URL('/dashboard/integrations', env('SITE_URL'))
  u.searchParams.set('gmail', status)
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
async function verify(state: string): Promise<{ firm: string; user: string; at: number } | null> {
  const [data, sig] = state.split('.')
  if (!data || !sig || (await hmac(data)) !== sig) return null
  const p = JSON.parse(new TextDecoder().decode(fromB64url(data)))
  return Date.now() - p.at > STATE_TTL_MS ? null : p
}

async function start(req: Request, firmId?: string) {
  const me = await caller(req, firmId)
  if (me.role !== 'admin') throw new HttpError(403, 'Only admins can connect Gmail')
  const state = await sign({ firm: me.firmId, user: me.user.id, at: Date.now(), n: crypto.randomUUID() })
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.search = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: callbackUrl(), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  }).toString()
  return json({ url: u.toString() })
}

async function callback(url: URL) {
  if (url.searchParams.get('error')) return back('cancelled', url.searchParams.get('error') ?? undefined)
  const code = url.searchParams.get('code'), state = await verify(url.searchParams.get('state') ?? '')
  if (!code || !state) return back('error', 'The sign-in link expired. Try connecting again.')

  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: callbackUrl(), grant_type: 'authorization_code' }),
  })
  const t = await tok.json()
  if (!tok.ok) return back('error', t.error_description ?? t.error ?? 'Google refused the connection')
  if (!t.refresh_token) return back('error', 'Google did not return offline access. Remove UNIR from your Google account’s third-party access and try again.')
  const granted = String(t.scope ?? '').split(' ')
  if (!granted.includes('https://www.googleapis.com/auth/gmail.send')) return back('error', 'Allow UNIR to send email when Google asks, then try again.')

  const who = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } }).then(r => r.json())
  const db = admin()
  const now = new Date().toISOString()
  const { error } = await db.from('google_connections').upsert({
    firm_id: state.firm, provider: 'gmail', email: who.email ?? '', refresh_token: t.refresh_token, access_token: t.access_token,
    expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(), scopes: granted, connected_by: state.user, connected_at: now,
  }, { onConflict: 'firm_id,provider' })
  if (error) return back('error', error.message)
  await db.from('integrations').upsert({ firm_id: state.firm, provider: 'gmail', enabled: true, settings: { email: who.email ?? '' }, connected_at: now }, { onConflict: 'firm_id,provider' })
  await audit({ firmId: state.firm, actorType: 'user', actorId: state.user, action: 'integration.gmail.connected', meta: { email: who.email } })
  return back('connected', who.email)
}

async function disconnect(req: Request, firmId?: string) {
  const me = await caller(req, firmId)
  if (me.role !== 'admin') throw new HttpError(403, 'Only admins can disconnect Gmail')
  const db = admin()
  const { data: c } = await db.from('google_connections').select('refresh_token, email').eq('firm_id', me.firmId).eq('provider', 'gmail').maybeSingle()
  if (c?.refresh_token) await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: c.refresh_token }) }).catch(() => {})
  await db.from('google_connections').delete().eq('firm_id', me.firmId).eq('provider', 'gmail')
  await db.from('integrations').upsert({ firm_id: me.firmId, provider: 'gmail', enabled: false, settings: {}, connected_at: null }, { onConflict: 'firm_id,provider' })
  await audit({ firmId: me.firmId, actorType: 'user', actorId: me.user.id, action: 'integration.gmail.disconnected', meta: { email: c?.email } })
  return json({ ok: true })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (req.method === 'GET') return await callback(new URL(req.url))
    if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
    const b = await body<{ action?: string; firm_id?: string }>(req)
    if (b.action === 'start') return await start(req, b.firm_id)
    if (b.action === 'disconnect') return await disconnect(req, b.firm_id)
    throw new HttpError(400, 'Unknown action')
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status >= 500) console.error(e)
    if (req.method === 'GET') return back('error', e instanceof Error ? e.message : 'Something went wrong')
    return json({ error: e instanceof Error ? e.message : 'Something went wrong' }, status)
  }
})
