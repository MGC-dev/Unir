import { useEffect, useMemo, useRef, useState } from 'react'
import { firmApi } from '../../api'
import type { Firm, FirmBrand } from '../../api/types'
import { InfoTip } from '../../shared/InfoTip'
import { Seg } from '../../shared/ui'
import { renderEmail } from '../../shared/emailLayout'

const DEFAULT: FirmBrand = { color: '#0f2347', signature: '', footer: '' }
const SAMPLE = {
  campaign: 'Hi Rachel,\n\nThis month we’re offering free 20-minute consultations for new family law matters. Reply to this email and we’ll find a time that suits you.',
  direct: 'Hi Rachel,\n\nThanks for reaching out about your custody question. Is now a good time for a quick call? If not, reply with a time that suits you.',
}
const same = (a: FirmBrand, b: FirmBrand) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Settings → Email design: the firm's logo, colour, signature and footer, wrapped around every email it sends
 * (campaigns, one-to-one emails, agent reports). The preview uses the same layout as the server, so it is exactly
 * what clients get.
 */
export function EmailDesign({ firm }: { firm: Firm }) {
  const saved = firm.brand ?? DEFAULT
  const [draft, setDraft] = useState<FirmBrand>(saved)
  const [kind, setKind] = useState<'campaign' | 'direct'>('campaign')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const canEdit = firmApi.canEdit()
  const dirty = !same(draft, saved)
  const set = (patch: Partial<FirmBrand>) => { setDraft(d => ({ ...d, ...patch })); setError('') }

  // Saved elsewhere (another admin, or a reload): start from the latest.
  useEffect(() => { if (!dirty) setDraft(saved) }, [JSON.stringify(saved)]) // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => renderEmail(
    { firmName: firm.name || 'Your firm', logoUrl: draft.logoUrl, color: draft.color, signature: draft.signature, footer: draft.footer },
    SAMPLE[kind], { marketing: kind === 'campaign' },
  ).html, [draft, kind, firm.name])

  const pickLogo = async (file?: File) => {
    if (!file) return
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { setError('Use a PNG, JPG, GIF or WebP image.'); return }
    if (file.size > 1024 * 1024) { setError('Logos can be up to 1 MB.'); return }
    setUploading(true)
    try { set({ logoUrl: await firmApi.uploadLogo(file) }) } catch (e) { if (e instanceof Error && e.message !== 'demo') setError(e.message) } finally { setUploading(false) }
  }
  const save = async () => {
    if (!/^#[0-9a-f]{6}$/i.test(draft.color)) { setError('Use a colour like #0f2347.'); return }
    await firmApi.saveBrand({ ...draft, signature: draft.signature.trim(), footer: draft.footer.trim() })
  }

  return (
    <section className="group emaildesign">
      <div className="emaildesign__head">
        <div className="titlerow"><h2>Email design</h2><InfoTip text="Wrapped around every email your firm sends: campaigns and surveys, emails to a single lead, and agent reports." label="About email design" /></div>
        {canEdit && (
          <div className="emaildesign__actions">
            {dirty && <button className="btn btn--sm" type="button" onClick={() => { setDraft(saved); setError('') }}>Cancel</button>}
            <button className="btn btn--sm btn--prominent" type="button" disabled={!dirty} onClick={save}>Save design</button>
          </div>
        )}
      </div>
      {!canEdit && <p className="footnote">Only your firm’s admins can change the email design.</p>}

      <div className="emaildesign__grid">
        <fieldset className="emaildesign__form" disabled={!canEdit}>
          <div className="enq__field">
            <span className="emaildesign__label">Logo</span>
            <div className="emaildesign__logo">
              <span className="emaildesign__logobox">{draft.logoUrl ? <img src={draft.logoUrl} alt="Your logo" /> : <em>No logo</em>}</span>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => { void pickLogo(e.target.files?.[0]); e.target.value = '' }} />
              <button className="btn btn--sm" type="button" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? 'Uploading…' : draft.logoUrl ? 'Replace' : 'Upload logo'}</button>
              {draft.logoUrl && <button className="btn btn--sm btn--plain" type="button" onClick={() => set({ logoUrl: undefined })}>Remove</button>}
            </div>
            <span className="enq__hint">PNG or JPG, up to 1 MB. Shown 44 pixels tall. Without a logo, your firm’s name is shown.</span>
          </div>

          <label className="enq__field">
            <span>Brand colour</span>
            <span className="emaildesign__color">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : '#0f2347'} onChange={e => set({ color: e.target.value })} aria-label="Pick a colour" />
              <input value={draft.color} onChange={e => set({ color: e.target.value.trim() })} maxLength={7} spellCheck={false} aria-label="Colour code" />
            </span>
            <span className="enq__hint">The bar across the top, and your name when there is no logo.</span>
          </label>

          <label className="enq__field">
            <span>Signature</span>
            <textarea rows={4} value={draft.signature} onChange={e => set({ signature: e.target.value })} placeholder={'Kind regards,\nThe intake team\n' + (firm.name || 'Your firm')} />
          </label>

          <label className="enq__field">
            <span>Footer</span>
            <textarea rows={3} value={draft.footer} onChange={e => set({ footer: e.target.value })} placeholder={'12 Long Street, Cape Town 8001\n+27 21 000 0000 · www.yourfirm.co.za'} />
            <span className="enq__hint">Small print at the bottom: your address and contact details. Campaigns also get a line on how to unsubscribe.</span>
          </label>

          {error && <p className="emaildesign__error" role="alert">{error}</p>}
        </fieldset>

        <div className="emaildesign__preview">
          <div className="emaildesign__previewhead">
            <span className="caption">Preview</span>
            <Seg label="Preview as" value={kind} onChange={setKind} options={[['campaign', 'Campaign'], ['direct', 'One-to-one']]} />
          </div>
          <iframe title="Email preview" srcDoc={preview} sandbox="" className="emaildesign__frame" />
        </div>
      </div>
    </section>
  )
}
