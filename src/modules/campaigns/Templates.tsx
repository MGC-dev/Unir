import { useMemo, useState } from 'react'
import { IconPlus } from '@tabler/icons-react'
import { templatesApi, useQuery } from '../../api'
import type { MessageTemplate } from '../../api/types'
import { useUi } from '../../app/UiContext'
import { type Col, DataTable, SortMenu, sortRows, useTableView } from '../../shared/DataTable'
import { HeaderActions } from '../../shared/HeaderActions'
import { ExpandingSearch, FilterMenu } from '../../shared/HeaderTools'
import { Icon } from '../../shared/Icon'
import { Empty, Tag } from '../../shared/ui'
import { when } from '../../shared/format'
import { allInputs } from './campaignUtils'

const STORE = 'unir-templates-columns-v1'

/** How many inputs a template fills in, e.g. "3 inputs". */
const inputsUsed = (x: MessageTemplate) => allInputs(x.tags).filter(i => (x.body + (x.subject ?? '')).includes(i.token)).length

/** Saved texts and emails. Use them when starting a campaign, or from a lead with Send text. */
export function Templates() {
  const list = useQuery(() => templatesApi.list())
  const { openModal } = useUi()
  const [channel, setChannel] = useState('all')
  const [q, setQ] = useState('')

  const cols = useMemo<Col<MessageTemplate>[]>(() => [
    { id: 'name', label: 'Template', locked: true, sort: x => x.name.toLowerCase(), render: x => (
      <span className="ltable__who">
        <span className="ltable__avatar ltable__avatar--doc" aria-hidden="true"><Icon name={x.channel === 'Email' ? 'mail' : 'messages'} /></span>
        <span><b>{x.name}</b><small className="doclist__desc">{x.subject || x.body}</small></span>
      </span>) },
    { id: 'channel', label: 'Channel', defaultOn: true, sort: x => x.channel, render: x => <Tag>{x.channel}</Tag> },
    { id: 'inputs', label: 'Inputs', defaultOn: true, firstDir: 'desc', sort: x => inputsUsed(x), render: x => <span className="ltable__text num">{inputsUsed(x)}</span> },
    { id: 'updated', label: 'Updated', defaultOn: true, firstDir: 'desc', sort: x => x.updatedAt, render: x => <span className="ltable__text">{when(x.updatedAt)}<small className="doclist__size">{x.updatedBy}</small></span> },
    { id: 'created', label: 'Created', firstDir: 'desc', sort: x => x.createdAt, render: x => <span className="ltable__text">{when(x.createdAt)}</span> },
  ], [])
  const view = useTableView<MessageTemplate>(STORE, cols, { key: 'updated', dir: 'desc' })

  const term = q.trim().toLowerCase()
  const rows = sortRows((list ?? []).filter(x =>
    (channel === 'all' || x.channel === channel) && (!term || `${x.name} ${x.subject ?? ''} ${x.body}`.toLowerCase().includes(term))), view)
  const open = (x: MessageTemplate) => openModal({ type: 'template', template: x.id })

  return (
    <>
      <HeaderActions>
        <button type="button" className="iconbtn iconbtn--primary" aria-label="New template" title="New template" onClick={() => openModal({ type: 'template', template: null })}><IconPlus size={19} stroke={2.2} /></button>
        <ExpandingSearch value={q} onChange={setQ} />
        <span className="only-phone-inline"><SortMenu view={view} label="Sort templates" /></span>
        <FilterMenu label="Filter templates" activeLabel="Filters applied" sections={[
          { title: 'Channel', value: channel, onChange: setChannel, options: [{ value: 'all', label: 'All channels', badge: null }, { value: 'Text', label: 'Text', badge: null }, { value: 'Email', label: 'Email', badge: null }] },
        ]} />
      </HeaderActions>

      {!list ? null : !rows.length ? <Empty icon="campaigns">{list.length ? 'No templates match these filters.' : 'No templates yet. Add one with the plus.'}</Empty> : (
        <>
          <DataTable rows={rows} view={view} rowKey={x => x.id} onOpen={open} sortLabel="Sort templates" />
          <ul className="lcards only-phone">{rows.map(x => (
            <li key={x.id}>
              <button type="button" className="lcard" onClick={() => open(x)}>
                <span className="lcard__top"><span className="ltable__avatar ltable__avatar--doc" aria-hidden="true"><Icon name={x.channel === 'Email' ? 'mail' : 'messages'} /></span>
                  <span className="lcard__who"><b>{x.name}</b><small>{x.subject || x.body}</small></span></span>
                <span className="lcard__meta"><Tag>{x.channel}</Tag><span className="caption">Updated {when(x.updatedAt)}</span></span>
              </button>
            </li>
          ))}</ul>
        </>
      )}
    </>
  )
}
