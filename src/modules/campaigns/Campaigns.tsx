import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import type { Campaign, CampaignFolder } from '../../api/types'
import { campaignFoldersApi, useQuery } from '../../api'
import { useUi } from '../../app/UiContext'
import { type Col, DataTable, SortMenu, sortRows, useTableView } from '../../shared/DataTable'
import { HeaderActions } from '../../shared/HeaderActions'
import { ExpandingSearch, FilterMenu } from '../../shared/HeaderTools'
import { Icon } from '../../shared/Icon'
import { Empty, Field, Sheet, SheetFoot, Tag } from '../../shared/ui'
import { lower1, when } from '../../shared/format'
import { Templates } from './Templates'
import { AUDIENCES, surveyStats, campStats, kindLabel, scoreLabel, useCampaigns, useFirm } from './campaignUtils'

// v4: added the Folder column
const STORE = 'unir-campaigns-columns-v4'
const surveyScore = (c: Campaign) => surveyStats(c).score

/** "Sent to open leads" or "When a lead signs": who a campaign reaches. */
export const reach = (c: Campaign) => (c.kind !== 'auto' ? AUDIENCES[c.audience!].label : `When ${lower1(c.trigger ?? '')}`)
/** Every campaign is On, Off or a Draft that has not been sent or started yet. */
export const statusOf = (c: Campaign): 'on' | 'off' | 'draft' => (c.draft ? 'draft' : c.active ? 'on' : 'off')
export const KindTag = ({ c }: { c: Campaign }) => <Tag tone={c.kind === 'survey' ? 'green' : c.kind === 'broadcast' ? 'accent' : 'tint'}>{kindLabel(c)}</Tag>
export const StatusTag = ({ c }: { c: Campaign }) => {
  const s = statusOf(c)
  return s === 'on' ? <Tag tone="green" icon="check">On</Tag> : s === 'off' ? <Tag>Off</Tag> : <Tag tone="orange">Draft</Tag>
}

/** Every one-off send and automatic campaign, as a table. Open one for its message and results. */
export default function Campaigns() {
  const { filter } = useUi()
  return filter.campview === 'templates' ? <Templates /> : <CampaignList />
}

function CampaignList() {
  const camps = useCampaigns()
  const firm = useFirm()
  const folders = useQuery(() => campaignFoldersApi.list())
  const navigate = useNavigate()
  const { openModal, filter, setFilter } = useUi()
  const folder = filter.campfolder
  const setFolder = (f: string) => setFilter('campfolder', f)
  /** The folder dialog: null when closed, 'new' to create one, or the folder being renamed. */
  const [folderSheet, setFolderSheet] = useState<'new' | CampaignFolder | null>(null)
  const [type, setType] = useState('all')
  const [channel, setChannel] = useState('all')
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')

  const folderName = (id?: string) => folders?.find(f => f.id === id)?.name ?? ''
  const cols = useMemo<Col<Campaign>[]>(() => [
    { id: 'name', label: 'Campaign', locked: true, sort: c => c.name.toLowerCase(), render: c => (
      <span className="ltable__who">
        <span className="ltable__avatar ltable__avatar--doc" aria-hidden="true"><Icon name="campaigns" /></span>
        <span><b>{c.name}</b><small className="doclist__desc">{c.subject || c.body}</small></span>
      </span>) },
    { id: 'type', label: 'Type', defaultOn: true, sort: c => c.kind, render: c => <KindTag c={c} /> },
    { id: 'channel', label: 'Channel', defaultOn: true, sort: c => c.channel, render: c => <Tag>{c.channel}</Tag> },
    { id: 'status', label: 'Status', defaultOn: true, sort: c => statusOf(c), render: c => <StatusTag c={c} /> },
    { id: 'sent', label: 'Delivered', firstDir: 'desc', sort: c => campStats(c).sent, render: c => <span className="ltable__text num">{campStats(c).sent}</span> },
    { id: 'score', label: 'Score', firstDir: 'desc', sort: c => (c.kind === 'survey' ? surveyScore(c) : -999), render: c => <span className="ltable__text num">{c.kind === 'survey' ? scoreLabel(c) : '—'}</span> },
    { id: 'reach', label: 'Audience / trigger', sort: c => reach(c).toLowerCase(), render: c => <span className="ltable__text">{reach(c)}</span> },
    { id: 'opened', label: 'Opened', firstDir: 'desc', sort: c => campStats(c).opened, render: c => <span className="ltable__text num">{campStats(c).opened}</span> },
    { id: 'replied', label: 'Replied', firstDir: 'desc', sort: c => campStats(c).replied, render: c => <span className="ltable__text num">{campStats(c).replied}</span> },
    { id: 'when', label: 'Sent', firstDir: 'desc', sort: c => c.sentAt ?? 0, render: c => <span className="ltable__text">{c.sentAt ? when(c.sentAt) : '—'}</span> },
    { id: 'folder', label: 'Folder', defaultOn: true, sort: c => folderName(c.folderId) || '~', render: c => <span className="ltable__text">{folderName(c.folderId) || '—'}</span> },
  ], [folders]) // eslint-disable-line react-hooks/exhaustive-deps
  const view = useTableView<Campaign>(STORE, cols, { key: 'name', dir: 'asc' })

  if (!camps || !firm || !folders) return null
  // A folder that was deleted elsewhere falls back to All.
  const active = folder === 'all' || folder === 'unfiled' ? null : folders.find(f => f.id === folder)
  const shownFolder = folder !== 'all' && folder !== 'unfiled' && !active ? 'all' : folder
  const inFolder = (c: Campaign) => shownFolder === 'all' || (shownFolder === 'unfiled' ? !folders.some(f => f.id === c.folderId) : c.folderId === shownFolder)
  const count = (id: string) => camps.filter(c => (id === 'unfiled' ? !folders.some(f => f.id === c.folderId) : c.folderId === id)).length
  const removeFolder = async (f: CampaignFolder) => {
    const n = count(f.id)
    if (!confirm(`Delete the folder “${f.name}”?${n ? ` Its ${n} ${n === 1 ? 'campaign stays' : 'campaigns stay'}, as Unfiled.` : ''}`)) return
    await campaignFoldersApi.remove(f.id); setFolder('all')
  }
  const canEmail = firm.domainStatus === 'verified', canText = firm.textStatus === 'registered'
  const locked = !canEmail || !canText

  const term = q.trim().toLowerCase()
  const filtered = camps.filter(c => inFolder(c) &&
    (type === 'all' || c.kind === type) && (channel === 'all' || c.channel === channel) && (status === 'all' || statusOf(c) === status) &&
    (!term || `${c.name} ${c.subject ?? ''} ${c.body} ${c.channel}`.toLowerCase().includes(term)))
  const rows = sortRows(filtered, view)
  const open = (c: Campaign) => navigate(`/dashboard/campaigns/${c.id}`)

  return (
    <>
      <HeaderActions>
        <button type="button" className="iconbtn iconbtn--primary" aria-label="New campaign" title="New campaign" onClick={() => openModal({ type: 'newcamp', kind: 'broadcast', folderId: active?.id })}><IconPlus size={19} stroke={2.2} /></button>
        <ExpandingSearch value={q} onChange={setQ} />
        <span className="only-phone-inline"><SortMenu view={view} label="Sort campaigns" /></span>
        <FilterMenu label="Filter campaigns" activeLabel="Filters applied" sections={[
          { title: 'Type', value: type, onChange: setType, options: [{ value: 'all', label: 'All types', badge: null }, { value: 'broadcast', label: 'One-off', badge: null }, { value: 'survey', label: 'Survey', badge: null }, { value: 'auto', label: 'Automatic', badge: null }] },
          { title: 'Channel', value: channel, onChange: setChannel, options: [{ value: 'all', label: 'All channels', badge: null }, ...(['Email', 'Text', 'Text and Email'] as const).map(c => ({ value: c, label: c, badge: null }))] },
          { title: 'Status', value: status, onChange: setStatus, options: [{ value: 'all', label: 'All', badge: null }, { value: 'on', label: 'On', badge: null }, { value: 'off', label: 'Off', badge: null }, { value: 'draft', label: 'Draft', badge: null }] },
        ]} />
      </HeaderActions>

      {locked && (
        <div className="group callout">
          <div className="callout__text"><Icon name="alert" />
            <div><b>Some campaign messages are held</b>
              <p className="footnote">They send once {[!canEmail ? 'your email domain is verified' : null, !canText ? 'your texting number is registered' : null].filter(Boolean).join(' and ')}.</p></div>
          </div>
          <button className="btn btn--sm" type="button" onClick={() => navigate('/dashboard/settings')}>Open Settings</button>
        </div>
      )}

      <div className="folders" role="group" aria-label="Campaign folders">
        <button type="button" className="folder" aria-pressed={shownFolder === 'all'} onClick={() => setFolder('all')}>All campaigns<span className="folder__n">{camps.length}</span></button>
        {folders.map(f => (
          <button key={f.id} type="button" className="folder" aria-pressed={shownFolder === f.id} onClick={() => setFolder(f.id)}>
            <Icon name="folder" />{f.name}<span className="folder__n">{count(f.id)}</span>
          </button>
        ))}
        {count('unfiled') > 0 && folders.length > 0 && (
          <button type="button" className="folder" aria-pressed={shownFolder === 'unfiled'} onClick={() => setFolder('unfiled')}>Unfiled<span className="folder__n">{count('unfiled')}</span></button>
        )}
        <button type="button" className="chip--add" onClick={() => setFolderSheet('new')}><IconPlus size={15} stroke={2.4} />New folder</button>
        {active && (
          <span className="folders__tools">
            <button type="button" className="iconbtn" aria-label={`Rename ${active.name}`} title="Rename folder" onClick={() => setFolderSheet(active)}><IconPencil size={17} stroke={2} /></button>
            <button type="button" className="iconbtn" aria-label={`Delete ${active.name}`} title="Delete folder" onClick={() => removeFolder(active)}><IconTrash size={17} stroke={2} /></button>
          </span>
        )}
      </div>

      {folderSheet && <FolderSheet folder={folderSheet === 'new' ? null : folderSheet} taken={folders.map(f => f.name)} onClose={() => setFolderSheet(null)} onCreated={f => setFolder(f.id)} />}

      {!rows.length ? <Empty icon="campaigns">{shownFolder !== 'all' && !camps.some(inFolder) ? 'This folder is empty. Open a campaign and choose this folder under Details, or add a new one with the plus.' : 'No campaigns match these filters.'}</Empty> : (
        <>
          <DataTable rows={rows} view={view} rowKey={c => c.id} onOpen={open} sortLabel="Sort campaigns" />
          <ul className="lcards only-phone">{rows.map(c => (
            <li key={c.id}>
              <button type="button" className="lcard" onClick={() => open(c)}>
                <span className="lcard__top"><span className="ltable__avatar ltable__avatar--doc" aria-hidden="true"><Icon name="campaigns" /></span>
                  <span className="lcard__who"><b>{c.name}</b><small>{reach(c)}</small></span></span>
                <span className="lcard__meta"><KindTag c={c} /><StatusTag c={c} /><span className="caption">{campStats(c).sent} delivered</span></span>
              </button>
            </li>
          ))}</ul>
        </>
      )}
    </>
  )
}

/** Name a new folder, or rename one. Names must be unique (ignoring case). */
function FolderSheet({ folder, taken, onClose, onCreated }: { folder: CampaignFolder | null; taken: string[]; onClose: () => void; onCreated: (f: CampaignFolder) => void }) {
  const [name, setName] = useState(folder?.name ?? '')
  const clash = taken.some(t => t.toLowerCase() === name.trim().toLowerCase() && t !== folder?.name)
  const save = async () => {
    if (!name.trim() || clash) return
    if (folder) await campaignFoldersApi.rename(folder.id, name)
    else onCreated(await campaignFoldersApi.create(name))
    onClose()
  }
  return (
    <Sheet title={folder ? 'Rename folder' : 'New folder'} icon={<Icon name="folder" />} onClose={onClose}
      onSubmit={e => { e.preventDefault(); save() }} foot={<SheetFoot onCancel={onClose} primary={folder ? 'Rename' : 'Create folder'} disabled={!name.trim() || clash} />}>
      <div className="formgroup">
        <Field label="Name" id="fd-name"><input id="fd-name" autoFocus autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Holiday campaigns" /></Field>
      </div>
      {clash && <p className="hint hint--warn">There is already a folder with this name.</p>}
    </Sheet>
  )
}
