import { useEffect, useRef, useState } from 'react'
import { campaignsApi, servicesApi, templatesApi, useQuery } from '../../api'
import type { CampaignTag, TemplateChannel } from '../../api/types'
import { useUi } from '../../app/UiContext'
import { Icon } from '../../shared/Icon'
import { Select } from '../../shared/Select'
import { Sheet } from '../../shared/ui'
import { InputsPicker } from './InputsPicker'
import { fillIn, insertTag, useFirm } from './campaignUtils'

/** Write or edit a message template, with the same inputs as campaigns and a live preview. */
export function TemplateEditor({ id }: { id: string | null }) {
  const { openModal } = useUi()
  const firm = useFirm()
  const existing = useQuery(() => (id ? templatesApi.get(id) : Promise.resolve(undefined)), [id])
  const sample = useQuery(() => campaignsApi.audience('open'))?.sample
  const catalog = useQuery(() => servicesApi.list())
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<TemplateChannel>('Text')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<CampaignTag[]>([])
  const loaded = useRef(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<{ s: number; e: number } | null>(null)

  // Fill the form once the template arrives (it stays put while the store changes underneath).
  useEffect(() => {
    if (loaded.current || (id && !existing)) return
    loaded.current = true
    if (existing) { setName(existing.name); setChannel(existing.channel); setSubject(existing.subject ?? ''); setBody(existing.body); setTags(existing.tags ?? []) }
    else { setName('New template'); setBody('Hi {first}, ') }
  }, [id, existing])

  const close = () => openModal(null)
  const isEmail = channel === 'Email'
  const firmName = firm?.name ?? ''
  const svcNames = (sample?.serviceIds ?? []).map(s => catalog?.find(c => c.id === s)?.name).filter(Boolean).join(', ')
  const text = fillIn(body, sample, firmName, tags, svcNames)

  const merge = (token: string) => {
    const r = insertTag(body, token, caret.current)
    setBody(r.text); caret.current = { s: r.caret, e: r.caret }
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(r.caret, r.caret) })
  }
  const save = async () => {
    if (!name.trim() || !body.trim()) return
    const input = { name, channel, subject, body, tags }
    if (id) await templatesApi.update(id, input); else await templatesApi.create(input)
    close()
  }
  const remove = async () => { if (id) { await templatesApi.remove(id); close() } }

  if (id && !existing) return null
  return (
    <Sheet className="enq enq--camp" wide title={id ? 'Edit template' : 'New template'} info="Templates can be used when starting a campaign, or from a lead with Send text." icon={<Icon name="campaigns" />} onClose={close}
      onSubmit={e => { e.preventDefault(); save() }}
      foot={
        <div className="enq__foot">
          {id && <button className="btn btn--danger-plain" type="button" onClick={remove} style={{ marginRight: 'auto' }}>Delete</button>}
          <button className="btn" type="button" onClick={close}>Cancel</button>
          <button className="btn btn--prominent" type="submit" disabled={!name.trim() || !body.trim()}>Save template</button>
        </div>
      }>
      <div className="enq__split">
        <div className="enq__col">
          <fieldset className="enq__section">
            <legend>Template</legend>
            <div className="enq__grid">
              <label className="enq__field enq__field--wide"><span>Name</span><input id="tp-name" required autoComplete="off" value={name} onChange={e => setName(e.target.value)} /></label>
              <div className="enq__field enq__field--wide"><label htmlFor="tp-chan">Channel</label>
                <Select id="tp-chan" value={channel} onChange={v => setChannel(v as TemplateChannel)} options={[{ value: 'Text', label: 'Text' }, { value: 'Email', label: 'Email' }]} /></div>
            </div>
          </fieldset>

          <InputsPicker text={body + (isEmail ? subject : '')} tags={tags} onPick={merge} onCreate={g => setTags(t => [...t, g])} />

          <fieldset className="enq__section">
            <legend>Message</legend>
            <div className="enq__grid">
              {isEmail && <label className="enq__field enq__field--wide"><span>Email subject</span><input id="tp-subj" value={subject} onChange={e => setSubject(e.target.value)} /></label>}
              <label className="enq__field enq__field--wide"><span className="vh">Message</span>
                <textarea id="tp-body" ref={ta} rows={isEmail ? 8 : 5} value={body} onChange={e => setBody(e.target.value)}
                  onBlur={e => { caret.current = { s: e.target.selectionStart, e: e.target.selectionEnd } }} /></label>
            </div>
          </fieldset>
        </div>

        <div className="enq__section enq__preview" aria-live="polite">
          <p className="enq__legend">Preview{sample ? ` for ${sample.name}` : ''}</p>
          {isEmail ? (
            <div className="mail">
              <span className="caption">From intake@{firm?.domain}</span>
              <b>{fillIn(subject || '(No subject)', sample, firmName, tags, svcNames)}</b>
              <p style={{ whiteSpace: 'pre-line' }}>{text}</p>
            </div>
          ) : (
            <div className="phone">
              <span className="caption">{firm?.number}</span>
              <p className="bubble">{text}</p>
              <span className="caption">{text.length} characters</span>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
