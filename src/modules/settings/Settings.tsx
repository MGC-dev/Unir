import { useNavigate } from 'react-router-dom'
import { firmApi, live, useQuery } from '../../api'
import { Tag } from '../../shared/ui'
import { InfoTip } from '../../shared/InfoTip'
import { EmailDesign } from './EmailDesign'
import { DomainSetup } from './DomainSetup'

export default function Settings() {
  const f = useQuery(() => firmApi.get())
  const navigate = useNavigate()
  if (!f) return null
  const emailOk = f.domainStatus === 'verified', textOk = f.textStatus === 'registered'
  const live = emailOk && textOk
  return (
    <>
      <div className="grid3">
        <article className="group setup"><Tag tone="green" icon="check">Done</Tag><h3>Firm Signs Up</h3><p className="secondary">{f.name} created its workspace and invited its intake team.</p></article>
        <article className="group setup">
          {f.domainStatus === 'verified' ? <Tag tone="green" icon="check">Verified</Tag> : f.domainStatus === 'pending' ? <Tag tone="orange" icon="bolt">Checking DNS…</Tag> : <Tag>Not Verified</Tag>}
          <h3>Verify Email Domain</h3>
          <p className="secondary">{emailOk ? <>Emails send from intake@{f.domain}.</> : f.domain ? <>Add the DNS records for {f.domain} shown below. It’s usually done within an hour.</> : 'Add your firm’s domain below, then the DNS records it shows.'}</p>
        </article>
        <article className="group setup">
          {textOk ? <Tag tone="green" icon="check">Registered</Tag> : f.textStatus === 'review' ? <Tag tone="orange" icon="bolt">Carrier Review</Tag> : <Tag>Not Registered</Tag>}
          <h3>Register Texting</h3><p className="secondary">Your firm registers its brand and number with US carriers. This takes days to weeks.</p>
          <ol><li>Business details and EIN</li><li>Sample messages and opt-out wording</li><li>Number {f.number}</li></ol>
          {f.textStatus === 'unregistered' && <button className="btn btn--prominent" type="button" onClick={() => firmApi.submitTexting()}>Submit Registration</button>}
          {f.textStatus === 'review' && <><p className="footnote">Submitted. Carriers usually reply in days to weeks.</p>{!live && <button className="btn" type="button" onClick={() => firmApi.approveTexting()}>Approve Now (Demo)</button>}</>}
          {textOk && <p className="footnote">Texts send from {f.number}.</p>}
        </article>
      </div>
      <div className="group callout">
        <div className="titlerow"><h2>{live ? 'Campaigns Are Live' : 'Campaigns Unlock When Both Are Done'}</h2><InfoTip text="Each firm has its own domain, number and sender reputation. The firm is the legal sender." label="About campaign setup" /></div>
        {live ? <button className="btn" type="button" onClick={() => navigate('/campaigns')}>Open Campaigns</button> : <span className="tag">{(emailOk ? 1 : 0) + (textOk ? 1 : 0)} of 2 Done</span>}
      </div>
      <DomainSetup key={f.domain} firm={f} />
      <EmailDesign firm={f} />
    </>
  )
}
