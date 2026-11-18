import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { firmApi, live, systemApi, useQuery } from '../api'
import { toast } from '../shared/toast'
import { Icon } from '../shared/Icon'
import { Sheet, Tag } from '../shared/ui'
import { Select } from '../shared/Select'
import { VIEWS, TABS } from './nav'
import { useUi } from './UiContext'
import { tourStore } from '../modules/tour/tourStore'
import { useAuth } from './auth'

type Kind = 'more' | 'help' | 'account' | 'team'

function RowBtn({ icon, title, sub, onClick }: { icon: string; title: string; sub?: string; onClick: () => void }) {
  return (
    <li><button type="button" className="row" onClick={onClick}>
      <Icon name={icon} /><span className="row__main"><b>{title}</b>{sub && <span>{sub}</span>}</span><Icon name="chev" small className="chev" />
    </button></li>
  )
}

/** The small utility sheets: More (phone), Help, Account and Team. */
export function AccountSheet({ kind }: { kind: Kind }) {
  const { openModal, closeAll } = useUi()
  const navigate = useNavigate()
  const firm = useQuery(() => firmApi.get())
  const team = useQuery(() => firmApi.team()) ?? []
  const auth = useAuth()
  const close = () => openModal(null)
  const go = (path: string) => { closeAll(); navigate(path) }

  if (kind === 'more') return (
    <Sheet title="More" onClose={close}>
      <ul className="group rows">
        {VIEWS.filter(v => !TABS.includes(v.id)).map(v => <RowBtn key={v.id} icon={v.icon} title={v.label} sub={v.sub} onClick={() => go(v.path)} />)}
        <RowBtn icon="help" title="Help and Resources" sub="The guided tour, setup guide and support" onClick={() => openModal({ type: 'help' })} />
      </ul>
    </Sheet>
  )
  if (kind === 'help') return (
    <Sheet title="Help and Resources" sub={live ? undefined : 'Sample data only. Nothing is sent.'} info="Each firm runs its own workspace: its own team, data, domain and number." onClose={close}>
      <ul className="group rows">
        {!live && <RowBtn icon="arrow" title="Take the Guided Tour" sub="Seven steps, from firm onboarding to reports" onClick={() => { closeAll(); tourStore.restart() }} />}
        <RowBtn icon="gear" title="Firm Setup Guide" sub="Verify your email domain and register texting" onClick={() => go('/settings')} />
        <RowBtn icon="messages" title="Contact Support" sub="The UNIR team replies within one business day" onClick={() => { close(); toast('Message sent to support', 'The UNIR team replies within one business day') }} />
        {live
          ? <RowBtn icon="bolt" title="Reload Data" sub="Fetch the latest from the server, including teammates’ changes" onClick={async () => { close(); await systemApi.reset() }} />
          : <RowBtn icon="bolt" title="Reset Sample Data" sub="Start again with the sample firm" onClick={async () => { close(); tourStore.set({ leadId: null, step: 0 }); await systemApi.reset() }} />}
      </ul>
    </Sheet>
  )
  if (kind === 'account') return (
    <Sheet title={auth.displayName} sub={auth.enabled ? [auth.user?.email !== auth.displayName ? auth.user?.email : null, firm?.name].filter(Boolean).join(' · ') : `Intake Manager, ${firm?.name ?? ''}`} onClose={close}>
      <ul className="group rows">
        <RowBtn icon="leads" title="Team and Permissions" sub="Your firm invites its own people and sets who can do what" onClick={() => openModal({ type: 'team' })} />
        <RowBtn icon="gear" title="Firm Settings" sub="Your sending domain, texting number and workspace" onClick={() => go('/settings')} />
        <RowBtn icon="arrow" title="Sign Out" sub={auth.enabled ? undefined : 'Demo mode: there is no account to sign out of'} onClick={async () => {
          close()
          if (!auth.enabled) { navigate('/sign-in'); return }
          try { await auth.signOut(); navigate('/sign-in', { replace: true }) } catch (e) { toast('Could not sign out', e instanceof Error ? e.message : undefined) }
        }} />
      </ul>
    </Sheet>
  )
  return (
    <Sheet title="Team and Permissions" sub={`${firm?.name ?? ''} manages who has access.`} onClose={close}>
      <ul className="group rows">
        {team.map(m => (
          <li key={m.name}><div className="row" style={{ cursor: 'default' }}>
            <span className="avatar" style={{ background: 'var(--tint-soft)', color: 'var(--tint-soft-ink)' }} aria-hidden="true">{m.name.split(' ').map(x => x[0]).join('')}</span>
            <span className="row__main"><b>{m.name}</b><span>{m.role}</span></span>
            <Tag tone={m.permission === 'Admin' ? 'accent' : undefined}>{m.permission}</Tag>
          </div></li>
        ))}
      </ul>
      {firmApi.canEdit()
        ? <InviteForm firmName={firm?.name ?? ''} />
        : <p className="footnote" style={{ padding: '0 var(--s4)' }}>Only your firm’s admins can invite people. Ask one of them to add your teammate.</p>}
    </Sheet>
  )
}

/** Invite a teammate: they get an email, choose a password, and join the firm with the chosen permission. */
function InviteForm({ firmName }: { firmName: string }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true); setError('')
    try { await firmApi.invite(email.trim(), name.trim(), role); setEmail(''); setName(''); setRole('member') }
    catch (err) { setError(err instanceof Error ? err.message : 'The invite couldn’t be sent.') }
    finally { setBusy(false) }
  }
  return (
    <form className="invite" onSubmit={submit}>
      <h3 className="invite__title">Invite a teammate</h3>
      <div className="invite__grid">
        <label className="enq__field"><span>Email</span><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@yourfirm.com" autoComplete="off" /></label>
        <label className="enq__field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} placeholder="Their full name" autoComplete="off" /></label>
        <div className="enq__field"><label htmlFor="inv-role">Permission</label>
          <Select contain id="inv-role" value={role} onChange={v => setRole(v as 'member' | 'admin')} options={[{ value: 'member', label: 'Member: works with leads, tasks and campaigns' }, { value: 'admin', label: 'Admin: also manages the team and firm settings' }]} /></div>
      </div>
      {error && <p className="invite__error" role="alert">{error}</p>}
      <div className="invite__foot">
        <span className="footnote">They get an email from {firmName || 'your firm'} to choose a password.</span>
        <button className="btn btn--prominent" type="submit" disabled={!valid || busy}>{busy ? 'Sending…' : 'Send invite'}</button>
      </div>
    </form>
  )
}
