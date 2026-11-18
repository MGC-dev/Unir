// Email domain setup (Settings). An admin types the firm's domain; the portal adds it to MGC's email service and
// lists the DNS records to add at the domain host. The status turns "Verified" by itself once the records are found
// (the email service tells the portal), and "Check now" asks straight away.
import { useEffect, useState } from 'react'
import { firmApi, live } from '../../api'
import type { DnsRecord, Firm } from '../../api/types'
import { Tag } from '../../shared/ui'
import { toast } from '../../shared/toast'

const RECORD_TONE: Record<string, 'green' | 'orange' | 'red' | undefined> = { verified: 'green', pending: 'orange', temporary_failure: 'orange', failed: 'red' }
const RECORD_LABEL: Record<string, string> = { verified: 'Found', pending: 'Checking', temporary_failure: 'Checking', failed: 'Not found', not_started: 'Not added yet' }

/** Hosts show the full name, so "send" for firm.com is "send.firm.com". Most hosts also accept just "send". */
const hostOf = (r: DnsRecord, domain: string) => `${r.name}.${domain}`

export function DomainSetup({ firm }: { firm: Firm }) {
  const canEdit = firmApi.canEdit()
  const [editing, setEditing] = useState(!firm.domain)
  const [value, setValue] = useState(firm.domain)
  const [busy, setBusy] = useState<'' | 'add' | 'check'>('')
  const [error, setError] = useState('')
  const records = firm.domainRecords ?? []
  const verified = firm.domainStatus === 'verified'

  // While the records are being checked, look again every minute (only while Settings is open).
  useEffect(() => {
    if (!live || !canEdit || verified || !firm.domain) return
    const id = setInterval(() => { firmApi.checkDomain({ quiet: true }).catch(() => undefined) }, 60_000)
    return () => clearInterval(id)
  }, [canEdit, verified, firm.domain])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim() || busy) return
    setBusy('add'); setError('')
    try { await firmApi.addDomain(value.trim()); setEditing(false) }
    catch (err) { setError(err instanceof Error ? err.message : 'The domain couldn’t be added.') }
    finally { setBusy('') }
  }
  const check = async () => {
    setBusy('check'); setError('')
    try { await firmApi.checkDomain() } catch (err) { setError(err instanceof Error ? err.message : 'The check didn’t go through.') }
    finally { setBusy('') }
  }
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast('Copied', text.length > 48 ? text.slice(0, 48) + '…' : text), () => undefined)

  return (
    <section className="group domain">
      <div className="domain__head">
        <div>
          <h2>Email Domain</h2>
          <p className="secondary">{verified
            ? <>Campaigns and automatic emails send from <b>intake@{firm.domain}</b>.</>
            : firm.domain ? <>Add these records where you manage <b>{firm.domain}</b> (GoDaddy, Cloudflare, Google Domains…). The status updates by itself once they’re found, usually within an hour.</>
            : 'Your firm’s emails send from its own domain, so clients see your name and replies come to you.'}</p>
        </div>
        {firm.domain && !editing && (verified ? <Tag tone="green" icon="check">Verified</Tag> : firm.domainStatus === 'pending' ? <Tag tone="orange" icon="bolt">Checking DNS</Tag> : <Tag>Waiting for records</Tag>)}
      </div>

      {editing && canEdit ? (
        <form className="domain__form" onSubmit={add}>
          <label className="enq__field"><span>Your firm’s domain</span>
            <input value={value} onChange={e => setValue(e.target.value)} placeholder="yourfirm.com" autoComplete="off" spellCheck={false} /></label>
          <button className="btn btn--prominent" type="submit" disabled={!value.trim() || !!busy}>{busy === 'add' ? 'Adding…' : 'Add domain'}</button>
          {firm.domain && <button className="btn" type="button" onClick={() => { setEditing(false); setValue(firm.domain); setError('') }}>Cancel</button>}
        </form>
      ) : !firm.domain ? (
        <p className="footnote">Ask a firm admin to add your domain.</p>
      ) : null}

      {error && <p className="invite__error" role="alert">{error}</p>}

      {firm.domain && !editing && records.length > 0 && (
        <div className="domain__records" role="table" aria-label="DNS records">
          <div className="domain__row domain__row--head" role="row">
            <span role="columnheader">Type</span><span role="columnheader">Name</span><span role="columnheader">Value</span><span role="columnheader">Priority</span><span role="columnheader">Status</span>
          </div>
          {records.map((r, i) => (
            <div className="domain__row" role="row" key={i}>
              <span role="cell" className="domain__type">{r.type}</span>
              <button role="cell" type="button" className="domain__copy" title="Copy" onClick={() => copy(hostOf(r, firm.domain))}>{hostOf(r, firm.domain)}</button>
              <button role="cell" type="button" className="domain__copy domain__value" title="Copy" onClick={() => copy(r.value)}>{r.value}</button>
              <span role="cell">{r.priority ?? ''}</span>
              <span role="cell">{RECORD_TONE[r.status] ? <Tag tone={RECORD_TONE[r.status]}>{RECORD_LABEL[r.status] ?? r.status}</Tag> : <Tag>{RECORD_LABEL[r.status] ?? r.status}</Tag>}</span>
            </div>
          ))}
        </div>
      )}
      {firm.domain && !editing && !records.length && !live && (
        <div className="dns">{`TXT   send.${firm.domain}  "v=spf1 include:amazonses.com ~all"\nTXT   resend._domainkey.${firm.domain}  p=MIGf…`}</div>
      )}

      {firm.domain && !editing && canEdit && (
        <div className="domain__foot">
          <span className="footnote">{records.length ? 'Click a name or value to copy it.' : ''}{firm.domainCheckedAt ? ` Last checked ${new Date(firm.domainCheckedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}</span>
          <div className="domain__actions">
            <button className="btn" type="button" onClick={() => { setEditing(true); setError('') }}>Change domain</button>
            {!verified && <button className="btn btn--prominent" type="button" onClick={check} disabled={!!busy}>{busy === 'check' ? 'Checking…' : 'Check now'}</button>}
          </div>
        </div>
      )}
    </section>
  )
}
