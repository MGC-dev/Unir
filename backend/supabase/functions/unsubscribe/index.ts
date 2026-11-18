// One-click unsubscribe (RFC 8058): Gmail, Apple Mail and others call this from their own "Unsubscribe" button,
// using the List-Unsubscribe header on campaign emails. POST ?t=<token> opts the lead out.
// GET shows a short confirmation in plain text (email scanners open links, so GET never unsubscribes on its own);
// the friendly page with a button lives in the portal at /unsubscribe.
// Deploy with verify_jwt = false: mail providers have no Supabase login; the token is the key.
import { admin } from '../_shared/core.ts'

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' } })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async req => {
  const t = new URL(req.url).searchParams.get('t') ?? ''
  if (!uuid.test(t)) return text('This unsubscribe link isn’t valid.', 400)
  const db = admin()
  if (req.method === 'POST') {
    const { data, error } = await db.rpc('unsubscribe_by_token', { t })
    if (error) return text('Something went wrong. Please try again.', 500)
    if (!data) return text('This unsubscribe link isn’t valid.', 404)
    return text(`You’re unsubscribed. ${data.firm} won’t send you campaign emails any more.`)
  }
  if (req.method === 'GET') {
    const { data } = await db.rpc('unsubscribe_info', { t })
    if (!data) return text('This unsubscribe link isn’t valid.', 404)
    return text(data.done ? `You’re already unsubscribed from ${data.firm}.` : `To unsubscribe from ${data.firm}, use the Unsubscribe link in the email.`)
  }
  return text('Use POST', 405)
})
