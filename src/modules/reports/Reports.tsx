import { useState } from 'react'
import { IconDownload } from '@tabler/icons-react'
import { campaignsApi, leadsApi, useQuery } from '../../api'
import { DAY, config } from '../../api/mockData'
import type { Lead } from '../../api/types'
import { HeaderActions } from '../../shared/HeaderActions'
import { FilterMenu } from '../../shared/HeaderTools'
import { Icon } from '../../shared/Icon'
import { InfoTip } from '../../shared/InfoTip'
import { Empty, Seg, Tag } from '../../shared/ui'
import { dayAt, money } from '../../shared/format'
import { campStats, kindLabel } from '../campaigns/campaignUtils'
import { SOURCES, STAGE, STAGES, isOpen, isWon } from '../lead/selectors'

type Period = '7' | '30' | '90' | 'all'
const PERIOD_LABEL: Record<Period, string> = { '7': 'last 7 days', '30': 'last 30 days', '90': 'last 90 days', all: 'all time' }

const isLost = (l: Lead) => l.stage === 'lost'
const pct = (n: number, d: number) => (d ? Math.round(n / d * 100) : null)
const pctLabel = (p: number | null) => (p === null ? '–' : p + '%')
/** Of the leads that were closed (signed or lost), the share that signed. */
const conversion = (ls: Lead[]) => pct(ls.filter(isWon).length, ls.filter(l => isWon(l) || isLost(l)).length)
const signedValue = (ls: Lead[]) => ls.filter(isWon).reduce((a, l) => a + l.value, 0)
/** Median days from enquiry to a signed engagement letter. */
function daysToSign(ls: Lead[]): number | null {
  const d = ls.filter(l => l.doc?.signed).map(l => (l.doc!.signed! - l.created) / DAY).sort((a, b) => a - b)
  if (!d.length) return null
  const m = d.length >> 1
  return Math.round((d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2) * 10) / 10
}
/** Leads that reached a stage: open or won leads at or past it, plus lost leads that got that far. */
function reached(ls: Lead[], stageIndex: number) {
  return ls.filter(l => isLost(l)
    ? stageIndex === 0 || (stageIndex === 1 && l.activities.some(a => a.type === 'call')) || (stageIndex === 2 && l.activities.some(a => a.type === 'meeting'))
    : STAGE[l.stage].i >= stageIndex).length
}

/** Enquiries per bucket: days for short periods, weeks for longer ones. */
function series(ls: Lead[], period: Period, all: Lead[]) {
  const days = period === 'all' ? Math.max(28, Math.ceil((Date.now() - Math.min(...all.map(l => l.created))) / DAY) + 1) : +period
  const step = days <= 31 ? 1 : 7
  const n = Math.ceil(days / step)
  const end = dayAt(0) + DAY
  return Array.from({ length: n }, (_, i) => {
    const e = end - (n - 1 - i) * step * DAY, s = e - step * DAY
    const inB = ls.filter(l => l.created >= s && l.created < e)
    return { start: new Date(s), step, n: inB.length, won: inB.filter(isWon).length }
  })
}

function toCsv(ls: Lead[]) {
  const cols: [string, (l: Lead) => string | number][] = [
    ['Name', l => l.name], ['Email', l => l.email], ['Phone', l => l.phone], ['Source', l => SOURCES[l.source]], ['Practice area', l => l.practice],
    ['Matter', l => l.matter], ['Stage', l => STAGE[l.stage]?.label ?? l.stage], ['Owner', l => l.owner], ['Fee', l => l.value],
    ['Received', l => new Date(l.created).toISOString().slice(0, 10)], ['Lost reason', l => l.lostReason ?? ''],
  ]
  const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [cols.map(c => c[0]).join(','), ...ls.map(l => cols.map(c => esc(c[1](l))).join(','))].join('\n')
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** One horizontal bar list: label, bar, count and a short note. */
const HBars = ({ rows, tone }: { rows: { key: string; label: string; n: number; sub: string }[]; tone?: 'red' }) => {
  const max = Math.max(1, ...rows.map(r => r.n))
  return (
    <ul className={'hbars rep__hbars' + (tone ? ' is-' + tone : '')}>{rows.map(r => (
      <li key={r.key} title={`${r.label}: ${r.n}${r.sub ? ', ' + r.sub : ''}`}>
        <span className="hbars__label">{r.label}</span><span className="hbars__track"><span style={{ width: r.n / max * 100 + '%' }} /></span><b>{r.n}</b><span className="hbars__sub">{r.sub}</span>
      </li>
    ))}</ul>
  )
}

/** Where leads come from, what converts, how the team is doing and why leads are lost, for a chosen period. */
export default function Reports() {
  const leads = useQuery(() => leadsApi.list())
  const camps = useQuery(() => campaignsApi.list())
  const [period, setPeriod] = useState<Period>('30')
  const [owner, setOwner] = useState('all')
  const [practice, setPractice] = useState('all')
  if (!leads || !camps) return null

  const match = (l: Lead) => (owner === 'all' || l.owner === owner) && (practice === 'all' || l.practice === practice)
  const since = period === 'all' ? 0 : Date.now() - +period * DAY
  const ls = leads.filter(l => match(l) && l.created >= since)
  const prev = period === 'all' ? null : leads.filter(l => match(l) && l.created >= since - +period * DAY && l.created < since)
  const delta = prev && prev.length ? Math.round((ls.length - prev.length) / prev.length * 100) : null
  const won = ls.filter(isWon), lost = ls.filter(isLost)
  const conv = conversion(ls), dts = daysToSign(ls)
  const range = PERIOD_LABEL[period]

  const header = (
    <HeaderActions>
      <Seg label="Period" value={period} onChange={setPeriod} options={[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']]} />
      <FilterMenu label="Filter reports" activeLabel="Filters applied" sections={[
        { title: 'Owner', value: owner, onChange: setOwner, options: [{ value: 'all', label: 'Everyone', badge: null }, ...config.owners.map(o => ({ value: o, label: o, badge: null }))] },
        { title: 'Practice area', value: practice, onChange: setPractice, options: [{ value: 'all', label: 'All practice areas', badge: null }, ...config.practiceAreas.map(p => ({ value: p, label: p, badge: null }))] },
      ]} />
      <button type="button" className="iconbtn" aria-label="Download leads as CSV" title="Download these leads as CSV" disabled={!ls.length}
        onClick={() => download(`leads-${range.replace(/\s+/g, '-')}.csv`, toCsv(ls))}><IconDownload size={18} stroke={2} /></button>
    </HeaderActions>
  )

  if (!ls.length) return <>{header}<Empty icon="reports">No leads came in during the {range}{owner !== 'all' || practice !== 'all' ? ' with these filters' : ''}. Try a longer period.</Empty></>

  // Trend
  const trend = series(ls, period, leads)
  const tmax = Math.max(1, ...trend.map(b => b.n))
  const ticks = [tmax, Math.round(tmax / 2), 0]
  const every = Math.ceil(trend.length / 8)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  // Funnel
  const funnel = STAGES.slice(0, 6).map((s, i) => ({ s, n: reached(ls, i) }))

  // Sources, practice areas, lost reasons, team
  const bySource = Object.keys(SOURCES).map(k => ({ k, rows: ls.filter(l => l.source === k) })).filter(x => x.rows.length).sort((a, b) => b.rows.length - a.rows.length)
  const smax = Math.max(1, ...bySource.map(x => x.rows.length))
  const byPractice = [...new Set(ls.map(l => l.practice))].map(p => { const r = ls.filter(l => l.practice === p); return { key: p, label: p, n: r.length, sub: r.some(isWon) ? money(signedValue(r)) : '' } }).sort((a, b) => b.n - a.n)
  const reasons: Record<string, number> = {}
  lost.forEach(l => { const r = l.lostReason ?? 'No reason given'; reasons[r] = (reasons[r] || 0) + 1 })
  const team = [...new Set(ls.map(l => l.owner))].map(o => ({ o, r: ls.filter(l => l.owner === o) })).sort((a, b) => signedValue(b.r) - signedValue(a.r) || b.r.length - a.r.length)

  // Campaigns (all time: they are not tied to when a lead came in)
  const campRows = camps.filter(c => campStats(c).sent > 0).sort((a, b) => campStats(b).sent - campStats(a).sent).slice(0, 6)

  return (
    <>
      {header}

      <div className="kpis rep__kpis">
        <div className="kpi kpi--hero"><span className="kpi__label">New leads, {range}</span><b className="kpi__value">{ls.length}</b>
          {delta !== null
            ? <span className={'kpi__delta ' + (delta >= 0 ? 'is-up' : 'is-down')}><Icon name="arrow" small />{Math.abs(delta)}% vs the {range.replace('last ', 'previous ')}</span>
            : <span className="kpi__sub" style={{ color: 'inherit', opacity: 0.75 }}>{prev ? `None in the ${range.replace('last ', 'previous ')}` : 'Since the first lead'}</span>}</div>
        <div className="kpi"><span className="kpi__label">Conversion</span><b className="kpi__value">{conv ?? '–'}{conv !== null && <small>%</small>}</b><span className="kpi__sub">{won.length} signed of {won.length + lost.length} closed</span></div>
        <div className="kpi"><span className="kpi__label">Signed value</span><b className="kpi__value">{money(signedValue(ls))}</b><span className="kpi__sub">{won.length ? `Average ${money(Math.round(signedValue(ls) / won.length))} per client` : 'Nothing signed yet'}</span></div>
        <div className="kpi"><span className="kpi__label">Time to sign</span><b className="kpi__value">{dts ?? '–'}{dts !== null && <small> days</small>}</b><span className="kpi__sub">Median, enquiry to signature</span></div>
        <div className="kpi"><span className="kpi__label">Open now</span><b className="kpi__value">{ls.filter(isOpen).length}</b><span className="kpi__sub">{lost.length} lost</span></div>
      </div>

      <section className="group panel panel--chart">
        <div className="panel__head"><div className="titlerow"><h2>New leads over time</h2><InfoTip text={`Leads that came in, ${trend[0]?.step === 7 ? 'per week' : 'per day'}. Hover a bar to see how many of them have signed.`} label="About this chart" /></div>
          <span className="footnote">{trend[0]?.step === 7 ? 'Per week' : 'Per day'}</span></div>
        <div className="chart">
          <div className="chart__y">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
          <div className="chart__plot">
            {trend.map((b, i) => {
              const lab = b.step === 7 ? `Week of ${fmt(b.start)}` : b.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              const pos = { left: `calc(${i} * 100% / ${trend.length})`, width: `calc(100% / ${trend.length})` }
              const ht = Math.max(b.n / tmax * 100, b.n ? 3 : 0)
              const last = i === trend.length - 1
              return (
                <span key={i}>
                  <div className={'vbar' + (last ? ' is-today' : '')} style={{ ...pos, ['--h' as string]: ht + '%' }} tabIndex={0} role="img"
                    aria-label={`${lab}: ${b.n} leads, ${b.won} signed`} data-tip={`${lab} · ${b.n} ${b.n === 1 ? 'lead' : 'leads'}${b.won ? `, ${b.won} signed` : ''}`}><span style={{ height: ht + '%' }} /></div>
                  <em className={'vbar__x' + (last ? ' is-today' : '')} style={pos}>{last ? (b.step === 7 ? 'This week' : 'Today') : (trend.length - 1 - i) % every === 0 ? fmt(b.start) : ''}</em>
                </span>
              )
            })}
          </div>
        </div>
      </section>

      <div className="grid2">
        <section className="group panel">
          <div className="panel__head"><div className="titlerow"><h2>Pipeline funnel</h2><InfoTip text="How many of these leads reached each stage, and the share that made it from the stage before." label="About the funnel" /></div></div>
          <HBars rows={funnel.map(({ s, n }, i) => ({ key: s.id, label: s.label, n, sub: i ? `${pctLabel(pct(n, funnel[i - 1].n))} of prev.` : '' }))} />
        </section>
        <section className="group panel">
          <div className="panel__head"><div className="titlerow"><h2>Why leads are lost</h2><InfoTip text="The reason picked when a lead was marked as lost." label="About lost reasons" /></div><span className="footnote">{lost.length} lost</span></div>
          {lost.length
            ? <HBars tone="red" rows={Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => ({ key: r, label: r, n, sub: `${pct(n, lost.length)}%` }))} />
            : <div className="empty"><Icon name="check" /><p>No leads lost in the {range}.</p></div>}
        </section>
      </div>

      <section className="group panel">
        <div className="panel__head"><div className="titlerow"><h2>What converts by source</h2><InfoTip text="Conversion is the share of closed leads (signed or lost) that signed." label="About conversion" /></div></div>
        <div className="table-wrap"><table className="rep__table">
          <thead><tr><th>Source</th><th className="num">Leads</th><th className="num">Signed</th><th className="num">Lost</th><th className="num">Conversion</th><th className="num">Signed value</th><th className="rep__sharecol">Share of leads</th></tr></thead>
          <tbody>{bySource.map(({ k, rows }) => (
            <tr key={k}><td><b>{SOURCES[k as keyof typeof SOURCES]}</b></td><td className="num">{rows.length}</td><td className="num">{rows.filter(isWon).length}</td>
              <td className="num">{rows.filter(isLost).length}</td><td className="num">{pctLabel(conversion(rows))}</td><td className="num">{rows.some(isWon) ? money(signedValue(rows)) : '–'}</td>
              <td><span className="rep__share"><span className="hbars__track"><span style={{ width: rows.length / smax * 100 + '%' }} /></span><em>{pct(rows.length, ls.length)}%</em></span></td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <div className="grid2">
        <section className="group panel">
          <div className="panel__head"><div className="titlerow"><h2>Team</h2><InfoTip text="Leads by owner, with what each has signed." label="About team" /></div></div>
          <div className="table-wrap"><table className="rep__table">
            <thead><tr><th>Owner</th><th className="num">Leads</th><th className="num">Signed</th><th className="num">Conv.</th><th className="num">Value</th><th className="num">Days to sign</th></tr></thead>
            <tbody>{team.map(({ o, r }) => (
              <tr key={o}><td><b>{o}</b></td><td className="num">{r.length}</td><td className="num">{r.filter(isWon).length}</td><td className="num">{pctLabel(conversion(r))}</td>
                <td className="num">{r.some(isWon) ? money(signedValue(r)) : '–'}</td><td className="num">{daysToSign(r) ?? '–'}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="group panel">
          <div className="panel__head"><div className="titlerow"><h2>Practice areas</h2><InfoTip text="Leads per practice area, with the value signed in each." label="About practice areas" /></div></div>
          <HBars rows={byPractice} />
        </section>
      </div>

      <section className="group panel">
        <div className="panel__head"><div className="titlerow"><h2>Campaign performance</h2><InfoTip text="The campaigns that have sent the most messages, all time. Open rate counts emails only." label="About campaign performance" /></div></div>
        {campRows.length ? (
          <div className="table-wrap"><table className="rep__table">
            <thead><tr><th>Campaign</th><th>Type</th><th className="num">Delivered</th><th className="num">Opened</th><th className="num">Replied</th></tr></thead>
            <tbody>{campRows.map(c => { const s = campStats(c); return (
              <tr key={c.id}><td><b>{c.name}</b></td><td><Tag>{kindLabel(c)}</Tag></td><td className="num">{s.sent}</td>
                <td className="num">{s.email ? pctLabel(pct(s.opened, s.email)) : '–'}</td><td className="num">{pctLabel(pct(s.replied, s.sent))}</td></tr>
            ) })}</tbody>
          </table></div>
        ) : <div className="empty"><p>No campaign messages delivered yet.</p></div>}
      </section>
    </>
  )
}
