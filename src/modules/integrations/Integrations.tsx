import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { integrationsApi, useQuery } from '../../api'
import type { Integration } from '../../api/types'
import { type Col, DataTable, SortMenu, sortRows, useTableView } from '../../shared/DataTable'
import { HeaderActions } from '../../shared/HeaderActions'
import { ExpandingSearch, FilterMenu } from '../../shared/HeaderTools'
import { Icon } from '../../shared/Icon'
import { Empty, Sheet, Tag } from '../../shared/ui'
import { toast } from '../../shared/toast'

import googleAdsLogo from '../landing/logos/google-ads.svg'
import googleCalendarLogo from '../landing/logos/google-calendar.svg'
import outlookLogo from '../landing/logos/outlook.svg'
import callrailLogo from '../landing/logos/callrail-mark.svg'
import gmailLogo from '../landing/logos/gmail.svg'

const STORE = 'unir-integrations-columns-v1'

/** Brand logos for the integrations that are a named product. Others (like the website form) keep a plain icon. */
const LOGO: Record<string, string> = { gmail: gmailLogo, ads: googleAdsLogo, gcal: googleCalendarLogo, outlook: outlookLogo, calls: callrailLogo }

/** The integration's logo on a white tile, or its icon when it has no brand. */
const Badge = ({ x, className = 'ltable__avatar' }: { x: Integration; className?: string }) => LOGO[x.id]
  ? <span className={className + ' integ__logo'} aria-hidden="true"><img src={LOGO[x.id]} alt="" /></span>
  : <span className={className + ' ltable__avatar--doc'} aria-hidden="true"><Icon name={x.icon} /></span>

/** What each integration does for the firm. Unknown ones fall under Other. */
const KIND: Record<string, string> = { web: 'Lead source', ads: 'Lead source', calls: 'Lead source', gcal: 'Calendar', outlook: 'Calendar and email', gmail: 'Email' }
const kindOf = (x: Integration) => KIND[x.id] ?? 'Other'
const StatusTag = ({ x }: { x: Integration }) => (x.on ? <Tag tone="green" icon="check">Connected</Tag> : <Tag>Not connected</Tag>)
/** The description, plus the connected account when there is one. */
const descOf = (x: Integration) => (x.account ? `Connected as ${x.account}. ${x.desc}` : x.desc)

/** Every integration as a table, like Documents. Open a row for details, or connect straight from the row. */
export default function Integrations() {
  const list = useQuery(() => integrationsApi.list())
  const navigate = useNavigate()
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  // Back from Google's consent screen: say how it went, then tidy the address.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const kind = params.has('gcal') ? 'gcal' : params.has('gmail') ? 'gmail' : null
    if (!kind) return
    const g = params.get(kind), name = kind === 'gcal' ? 'Google Calendar' : 'Gmail'
    const detail = params.get('detail') ?? undefined
    if (g === 'connected') toast(`${name} connected`, kind === 'gcal' ? `${detail ?? 'Your'} events now show in Calendar` : detail)
    else if (g === 'cancelled') toast(`${name} not connected`, 'Google sign-in was cancelled')
    else toast(`Couldn’t connect ${name}`, detail)
    setParams({}, { replace: true })
  }, [params, setParams])

  const cols = useMemo<Col<Integration>[]>(() => [
    { id: 'name', label: 'Integration', locked: true, sort: x => x.name.toLowerCase(), render: x => (
      <span className="ltable__who">
        <Badge x={x} />
        <span><b>{x.name}</b><small className="doclist__desc">{descOf(x)}</small></span>
      </span>) },
    { id: 'kind', label: 'Type', defaultOn: true, sort: x => kindOf(x), render: x => <Tag tone="tint">{kindOf(x)}</Tag> },
    { id: 'status', label: 'Status', defaultOn: true, sort: x => (x.on ? 0 : 1), render: x => <StatusTag x={x} /> },
    { id: 'action', label: 'Action', locked: true, sort: x => (x.on ? 0 : 1), render: x => (
      <button className={'btn btn--sm' + (x.on ? '' : ' btn--prominent')} type="button"
        onClick={e => { e.stopPropagation(); integrationsApi.toggle(x.id) }} onKeyDown={e => e.stopPropagation()}>
        {x.on ? 'Disconnect' : 'Connect'}
      </button>) },
  ], [])
  const view = useTableView<Integration>(STORE, cols, { key: 'name', dir: 'asc' })

  if (!list) return null
  const term = q.trim().toLowerCase()
  const rows = sortRows(list.filter(x =>
    (status === 'all' || (status === 'on') === x.on) && (!term || `${x.name} ${x.desc} ${kindOf(x)}`.toLowerCase().includes(term))), view)
  const opened = list.find(x => x.id === openId)

  return (
    <>
      <HeaderActions>
        <ExpandingSearch value={q} onChange={setQ} />
        <span className="only-phone-inline"><SortMenu view={view} label="Sort integrations" /></span>
        <FilterMenu label="Filter integrations" activeLabel="Filters applied" sections={[
          { title: 'Status', value: status, onChange: setStatus, options: [{ value: 'all', label: 'All', badge: null }, { value: 'on', label: 'Connected', badge: null }, { value: 'off', label: 'Not connected', badge: null }] },
        ]} />
      </HeaderActions>

      {!rows.length ? <Empty icon="plug">No integrations match these filters.</Empty> : (
        <>
          <DataTable rows={rows} view={view} rowKey={x => x.id} onOpen={x => setOpenId(x.id)} sortLabel="Sort integrations" />
          <ul className="lcards only-phone">{rows.map(x => (
            <li key={x.id}>
              <button type="button" className="lcard" onClick={() => setOpenId(x.id)}>
                <span className="lcard__top"><Badge x={x} />
                  <span className="lcard__who"><b>{x.name}</b><small>{descOf(x)}</small></span></span>
                <span className="lcard__meta"><Tag tone="tint">{kindOf(x)}</Tag><StatusTag x={x} /></span>
              </button>
            </li>
          ))}</ul>
        </>
      )}
      <p className="footnote" style={{ padding: '0 var(--s4)' }}>
        Sending from your own email domain is set up in <a href="/dashboard/settings" onClick={e => { e.preventDefault(); navigate('/dashboard/settings') }}>Settings</a>.
      </p>

      {opened && (
        <Sheet title={opened.name} sub={kindOf(opened)} icon={LOGO[opened.id] ? <img className="integ__sheetlogo" src={LOGO[opened.id]} alt="" /> : <Icon name={opened.icon} />} onClose={() => setOpenId(null)}
          foot={
            <div className="sheet__foot">
              <button className="btn" type="button" onClick={() => setOpenId(null)}>Close</button>
              <button className={'btn' + (opened.on ? '' : ' btn--prominent')} type="button" onClick={() => integrationsApi.toggle(opened.id)}>{opened.on ? 'Disconnect' : 'Connect'}</button>
            </div>
          }>
          <div className="formgroup" style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s3)', justifyItems: 'start' }}>
            <StatusTag x={opened} />
            <p className="secondary" style={{ margin: 0 }}>{descOf(opened)}</p>
          </div>
        </Sheet>
      )}
    </>
  )
}
