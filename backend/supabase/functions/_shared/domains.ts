// Keeps a firm's email domain in step with Resend: used by email-domain (add, check) and resend-webhook
// (domain.updated), so both save the same shape.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface ResendRecord { record: string; type: string; name: string; value: string; ttl?: string; priority?: number; status: string }
export interface ResendDomain { id: string; name: string; status: string; records?: ResendRecord[] }

/** Resend's statuses: not_started, pending, verified, partially_verified, failed, temporary_failure. */
export const firmStatus = (s: string): 'unverified' | 'pending' | 'verified' =>
  s === 'verified' ? 'verified' : s === 'pending' || s === 'temporary_failure' || s === 'partially_verified' ? 'pending' : 'unverified'

/** What the portal shows: the records to add at the domain host, each with its own status. */
export const recordsOf = (d: ResendDomain) => (d.records ?? []).map(r => ({
  record: r.record, type: r.type, name: r.name, value: r.value, ...(r.priority != null ? { priority: r.priority } : {}), status: r.status,
}))

/** Saves Resend's view of the domain on the firm. `domain` is set when the firm is adding a new one. */
export async function saveDomain(db: SupabaseClient, firmId: string, d: ResendDomain, domain?: string) {
  const row = {
    ...(domain ? { domain } : {}), resend_domain_id: d.id, domain_status: firmStatus(d.status),
    domain_records: recordsOf(d), domain_checked_at: new Date().toISOString(),
  }
  const { error } = await db.from('firms').update(row).eq('id', firmId)
  if (error) throw error
  return { domain: domain ?? d.name, status: row.domain_status, provider_status: d.status, records: row.domain_records }
}
