// Email domain setup from Settings (firm admins only). MGC runs one Resend account; each firm sends from its own
// domain in it.
// POST { action: 'add', domain }  adds the domain to Resend (open tracking on), saves the DNS records to show
// POST { action: 'check' }        asks Resend to check the DNS records now, and saves the result
// Resend also reports changes on its own through resend-webhook (domain.updated), so the firm's status turns
// "Verified" without anyone pressing a button.
import { HttpError, admin, audit, body, caller, env, handle, json } from '../_shared/core.ts'
import { type ResendDomain, saveDomain } from '../_shared/domains.ts'

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const REGION = Deno.env.get('RESEND_REGION') ?? 'us-east-1'

async function resend<T>(method: string, path: string, payload?: unknown): Promise<T> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method, headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(res.status === 422 || res.status === 409 ? 409 : 502, data?.message ?? `Resend: ${res.statusText}`)
  return data as T
}

/** Finds a domain already in MGC's Resend account by name. */
async function findInResend(name: string) {
  const list = await resend<{ data: { id: string; name: string }[] }>('GET', '/domains')
  return list.data.find(d => d.name === name) ?? null
}

handle(async req => {
  const b = await body<{ action?: 'add' | 'check'; domain?: string; firm_id?: string }>(req)
  const me = await caller(req, b.firm_id)
  if (me.role !== 'admin') throw new HttpError(403, 'Only firm admins can set up the email domain')
  const db = admin()
  const { data: firm } = await db.from('firms').select('id, domain, resend_domain_id').eq('id', me.firmId).single()
  if (!firm) throw new HttpError(404, 'Firm not found')

  if (b.action === 'check') {
    if (!firm.resend_domain_id) throw new HttpError(400, 'Add your domain first')
    await resend('POST', `/domains/${firm.resend_domain_id}/verify`).catch(() => null) // already verified: fine
    const d = await resend<ResendDomain>('GET', `/domains/${firm.resend_domain_id}`)
    return json(await saveDomain(db, firm.id, d))
  }

  if (b.action !== 'add') throw new HttpError(400, 'Unknown action')
  // People paste all sorts: "https://www.firm.com/", "@firm.com", "intake@firm.com".
  const name = (b.domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^.*@/, '').replace(/^www\./, '')
  if (!DOMAIN.test(name)) throw new HttpError(400, 'Enter a domain like yourfirm.com')
  if (firm.domain === name && firm.resend_domain_id) {
    const d = await resend<ResendDomain>('GET', `/domains/${firm.resend_domain_id}`)
    return json(await saveDomain(db, firm.id, d))
  }
  const { data: taken } = await db.from('firms').select('id').ilike('domain', name).neq('id', firm.id).maybeSingle()
  if (taken) throw new HttpError(409, 'Another firm already uses this domain. Contact MGC if it’s yours.')

  let d: ResendDomain
  const existing = await findInResend(name)
  if (existing) {
    // Already in MGC's account but not this firm's: only MGC can hand it over (it may be MGC's own domain).
    if (firm.domain !== name) throw new HttpError(409, 'This domain is already set up with MGC. Ask MGC to connect it to your firm.')
    d = await resend<ResendDomain>('GET', `/domains/${existing.id}`)
  } else {
    const created = await resend<{ id: string }>('POST', '/domains', { name, region: REGION })
    d = await resend<ResendDomain>('GET', `/domains/${created.id}`)
  }
  // Open tracking lets campaign results show who opened. Resend adds a tiny image to each email for this.
  await resend('PATCH', `/domains/${d.id}`, { open_tracking: true }).catch(e => console.error('open tracking', e))
  await resend('POST', `/domains/${d.id}/verify`).catch(() => null)
  const saved = await saveDomain(db, firm.id, d, name)
  await audit({ firmId: firm.id, actorType: 'user', actorId: me.user.id, action: 'domain.added', table: 'firms', recordId: firm.id, meta: { domain: name, previous: firm.domain } })
  return json(saved)
})
