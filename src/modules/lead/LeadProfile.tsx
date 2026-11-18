import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconArrowRight, IconPencil } from '@tabler/icons-react'
import type { Lead, SourceId } from '../../api/types'
import { config } from '../../api/mockData'
import { Select } from '../../shared/Select'
import { useUi } from '../../app/UiContext'
import { Icon } from '../../shared/Icon'
import { Tag, usePhone } from '../../shared/ui'
import { initials, money, when } from '../../shared/format'
import { leadsApi, servicesApi, useQuery, type LeadPatch } from '../../api'
import { priceLabel } from '../services/pricing'
import { SOURCES, feeKnown } from './selectors'

/**
 * Lead profile (opened from the Leads module): who the lead is and what they asked for.
 * The working view, with actions and activity, is the ticket in the Pipeline; the View in Pipeline button jumps there.
 */
export function LeadProfile({ lead: l, startEditing = false }: { lead: Lead; startEditing?: boolean }) {
  const { openProfile, openLead } = useUi()
  const navigate = useNavigate()
  const phone = usePhone()
  const panel = useRef<HTMLElement>(null)
  const catalog = useQuery(() => servicesApi.list()) ?? []
  const mine = (l.serviceIds ?? []).map(id => catalog.find(s => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s)
  useEffect(() => { panel.current?.focus({ preventScroll: true }) }, [])
  const [editing, setEditing] = useState(startEditing)

  const openTicket = () => {
    navigate('/pipeline')
    // the route change closes open panels, so open the ticket once it has settled
    setTimeout(() => openLead(l.id), 120)
  }

  return (
    <>
      <div className={'scrim' + (phone ? '' : ' scrim--light')} onClick={() => openProfile(null)} />
      <aside ref={panel} tabIndex={-1} className="inspector lead profile" role="dialog" aria-modal="true" aria-labelledby="p-title">
        <span className="grabber" aria-hidden="true" />
        <div className="sheet-head lead__head">
          <span className="lead__avatar" aria-hidden="true">{initials(l.name)}</span>
          <div className="sheet-head__title">
            <h2 id="p-title">{l.name}</h2>
            <span className="footnote">{l.matter}</span>
          </div>
          {!editing && <button className="iconbtn" type="button" onClick={() => setEditing(true)} aria-label="Edit details" title="Edit details"><IconPencil size={17} stroke={2} /></button>}
          <button className="closebtn" type="button" onClick={() => openProfile(null)} aria-label="Close"><Icon name="x" /></button>
        </div>

        {editing ? <EditLead lead={l} onDone={() => setEditing(false)} /> : <div className="inspector__body">
          <button className="btn btn--prominent profile__ticket" type="button" onClick={openTicket} title="Open this lead's ticket in the Pipeline">
            View in Pipeline<IconArrowRight size={18} stroke={2.2} />
          </button>

          <section className="lead__section">
            <h3 className="lead__label">Contact</h3>
            <dl className="lead__details">
              <div className="is-wide"><dt><Icon name="mail" small />Email</dt><dd><a href={`mailto:${l.email}`}>{l.email}</a></dd></div>
              <div className="is-wide"><dt><Icon name="phone" small />Phone</dt><dd><a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}>{l.phone}</a></dd></div>
            </dl>
          </section>

          <section className="lead__section">
            <h3 className="lead__label">Enquiry</h3>
            <dl className="lead__details">
              <div className="is-wide"><dt><Icon name="folder" small />Matter</dt><dd>{l.matter}</dd></div>
              {mine.length > 0 && <div className="is-wide"><dt><Icon name="services" small />Services</dt><dd>{mine.map(s => <div key={s.id}>{s.name} <span className="caption">· {priceLabel(s)}</span></div>)}</dd></div>}
              <div><dt><Icon name="leads" small />Practice area</dt><dd>{l.practice}</dd></div>
              {feeKnown(l) && <div><dt><Icon name="reports" small />Estimated fee</dt><dd className="num">{money(l.value)}</dd></div>}
              <div><dt><Icon name="globe" small />Source</dt><dd>{SOURCES[l.source]}</dd></div>
              <div><dt><Icon name="contacts" small />Owner</dt><dd>{l.owner}</dd></div>
              <div className="is-wide"><dt><Icon name="calendar" small />Received</dt><dd>{when(l.created)}</dd></div>
            </dl>
          </section>

          {l.notes && (
            <section className="lead__section">
              <h3 className="lead__label">Notes</h3>
              <p className="lead__notes">{l.notes}</p>
            </section>
          )}

          {l.doc && (
            <section className="lead__section">
              <h3 className="lead__label">Documents</h3>
              <div className="lead__doc">
                <span className="lead__next-icon"><Icon name="doc" /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{l.doc.items?.map(i => i.name).join(', ') || 'Engagement letter'}</b>
                  <p>Sent {when(l.doc.sent)}{l.doc.signed ? `, signed ${when(l.doc.signed)}` : ''}</p>
                </div>
                {l.doc.status === 'signed' ? <Tag tone="green" icon="check">Signed</Tag> : <Tag tone="orange">Awaiting signature</Tag>}
              </div>
            </section>
          )}

          {l.stage === 'lost' && l.lostReason && (
            <div className="lead__next lead__next--lost">
              <span className="lead__next-icon"><Icon name="x" /></span>
              <div><b>Reason lost</b><p>{l.lostReason}</p></div>
            </div>
          )}
        </div>}
      </aside>
    </>
  )
}

/** The lead's details as a form. Saving notes what changed on the timeline. */
function EditLead({ lead: l, onDone }: { lead: Lead; onDone: () => void }) {
  const [d, setD] = useState<Required<LeadPatch>>({
    name: l.name, email: l.email ?? '', phone: l.phone ?? '', matter: l.matter, practice: l.practice, source: l.source, owner: l.owner, notes: l.notes ?? '', optedOut: !!l.optedOut,
  })
  const [error, setError] = useState('')
  const set = (patch: Partial<LeadPatch>) => { setD(x => ({ ...x, ...patch })); setError('') }
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!d.name.trim()) { setError('The lead needs a name.'); return }
    if (d.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) { setError('That email address doesn’t look right.'); return }
    await leadsApi.update(l.id, { ...d, name: d.name.trim(), email: d.email.trim(), phone: d.phone.trim(), matter: d.matter.trim(), notes: d.notes.trim() })
    onDone()
  }
  const areas = config.practiceAreas.includes(d.practice) ? config.practiceAreas : [d.practice, ...config.practiceAreas]
  const owners = config.owners.includes(d.owner) || !d.owner ? config.owners : [d.owner, ...config.owners]
  return (
    <form className="inspector__body leadedit" onSubmit={save}>
      <section className="lead__section">
        <h3 className="lead__label">Contact</h3>
        <label className="enq__field"><span>Full name</span><input value={d.name} onChange={e => set({ name: e.target.value })} required autoFocus /></label>
        <label className="enq__field"><span>Email</span><input type="email" value={d.email} onChange={e => set({ email: e.target.value })} placeholder="name@example.com" /></label>
        <label className="enq__field"><span>Phone</span><input type="tel" inputMode="tel" value={d.phone} onChange={e => set({ phone: e.target.value })} /></label>
        <label className="leadedit__check"><input type="checkbox" checked={d.optedOut} onChange={e => set({ optedOut: e.target.checked })} />
          <span><b>Don’t message this person</b><small>They opted out. Campaigns and automatic messages skip them.</small></span></label>
      </section>
      <section className="lead__section">
        <h3 className="lead__label">Enquiry</h3>
        <label className="enq__field"><span>Matter</span><input value={d.matter} onChange={e => set({ matter: e.target.value })} /></label>
        <div className="enq__field"><label htmlFor="le-practice">Practice area</label>
          <Select contain id="le-practice" value={d.practice} onChange={v => set({ practice: v })} options={areas.map(p => ({ value: p, label: p }))} /></div>
        <div className="enq__field"><label htmlFor="le-source">Source</label>
          <Select contain id="le-source" value={d.source} onChange={v => set({ source: v as SourceId })} options={(Object.entries(SOURCES) as [SourceId, string][]).map(([v, label]) => ({ value: v, label }))} /></div>
        <div className="enq__field"><label htmlFor="le-owner">Owner</label>
          <Select contain id="le-owner" value={d.owner} onChange={v => set({ owner: v })} options={owners.map(o => ({ value: o, label: o }))} /></div>
        <label className="enq__field"><span>Notes</span><textarea rows={4} value={d.notes} onChange={e => set({ notes: e.target.value })} /></label>
      </section>
      {error && <p className="leadedit__error" role="alert">{error}</p>}
      <div className="leadedit__foot">
        <button className="btn" type="button" onClick={onDone}>Cancel</button>
        <button className="btn btn--prominent" type="submit">Save</button>
      </div>
    </form>
  )
}
