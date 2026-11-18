// Filling message inputs, and sending email through Resend.
import { HttpError, env } from './core.ts'
import { type EmailBrand, renderEmail } from './emailLayout.ts'

export { renderEmail }

export interface LeadRow {
  id: string; name: string; email: string; phone: string; matter: string; practice: string
  source: string; value: number; stage: string; owner_id: string | null; opted_out: boolean; unsubscribe_token?: string
}
export interface FirmRow {
  id: string; name: string; domain: string | null; domain_status: string; phone_number: string | null; text_status: string
  email_logo_url?: string | null; email_brand_color?: string | null; email_signature?: string | null; email_footer?: string | null
}

/** The firm's email design (Settings → Email design). */
export const brandOf = (f: FirmRow): EmailBrand => ({ firmName: f.name, logoUrl: f.email_logo_url, color: f.email_brand_color, signature: f.email_signature, footer: f.email_footer })
export interface Tag { id: string; label: string; source: string }

const SOURCES: Record<string, string> = { web: 'Website form', email: 'Email', text: 'Text', manual: 'Phone or walk-in', referral: 'Referral', ads: 'Google Ads' }
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

/** Fills {first}, {matter}, {firm} and any custom inputs, the same way the portal's preview does. */
export function fill(text: string, lead: LeadRow, firm: FirmRow, tags: Tag[] = [], extra: { owner?: string; services?: string } = {}) {
  const value = (source: string): string => ({
    name: lead.name, email: lead.email, phone: lead.phone, matter: lead.matter, practice: lead.practice,
    fee: money(Number(lead.value)), owner: extra.owner ?? '', source: SOURCES[lead.source] ?? lead.source,
    services: extra.services ?? '', firm: firm.name,
    today: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  } as Record<string, string>)[source] ?? ''
  let out = text.replace(/\{first\}/g, lead.name.split(' ')[0]).replace(/\{matter\}/g, lead.matter.toLowerCase()).replace(/\{firm\}/g, firm.name)
  for (const g of tags) out = out.split(`{${g.id}}`).join(value(g.source))
  return out
}

/** Why email can't go out for this firm yet, or null when it can. */
export const emailBlocked = (firm: FirmRow) =>
  !firm.domain ? 'The firm has no email domain set' : firm.domain_status !== 'verified' ? 'The firm’s email domain is not verified yet' : null
/** Texting has no provider connected yet (RingCentral or Twilio to come). */
export const textBlocked = (firm: FirmRow) =>
  firm.text_status !== 'registered' ? 'The firm’s texting number is not registered yet' : 'No texting provider is connected yet'

export const fromAddress = (firm: FirmRow) => `${firm.name} <intake@${firm.domain}>`

export interface Email { from: string; to: string | string[]; subject: string; text: string; html?: string; headers?: Record<string, string>; tags?: { name: string; value: string }[] }

/**
 * Unsubscribe links for one lead: the page in the portal (shown in the email), and the one-click endpoint that
 * Gmail and Apple Mail call from their own Unsubscribe button (RFC 8058).
 */
export function unsubscribeLinks(lead: LeadRow) {
  if (!lead.unsubscribe_token) return null
  const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, ''), api = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')
  const oneClick = `${api}/functions/v1/unsubscribe?t=${lead.unsubscribe_token}`
  return {
    page: site ? `${site}/unsubscribe?t=${lead.unsubscribe_token}` : oneClick,
    headers: { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }
}

async function resend(path: string, payload: unknown) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(502, `Resend: ${data?.message ?? res.statusText}`)
  return data
}

/** Sends one email. Returns Resend's id, used to match delivery and open events. */
export const sendEmail = async (e: Email): Promise<string> => (await resend('/emails', e)).id

/** Sends up to 100 emails in one request (Resend's batch limit). Returns their ids in the same order. */
export async function sendBatch(emails: Email[]): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < emails.length; i += 100) {
    const data = await resend('/emails/batch', emails.slice(i, i + 100))
    ids.push(...(data.data ?? []).map((x: { id: string }) => x.id))
  }
  return ids
}
