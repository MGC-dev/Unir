import { useNavigate } from 'react-router-dom'
import { firmApi, useQuery } from '../../api'
import { Tag } from '../../shared/ui'
import { InfoTip } from '../../shared/InfoTip'
import { EmailDesign } from './EmailDesign'
import { DomainSetup } from './DomainSetup'

export default function Settings() {
  const f = useQuery(() => firmApi.get())
  const navigate = useNavigate()
  if (!f) return null
  const emailOk = f.domainStatus === 'verified'
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
          <Tag tone="orange" icon="bolt">Coming Soon</Tag>
          <h3>Texting (SMS)</h3>
          <p className="secondary">Texting leads from your firm’s own number is rolling out soon. We’ll let you know when it’s ready to set up.</p>
        </article>
      </div>
      <div className="group callout">
        <div className="titlerow"><h2>{emailOk ? 'Email Campaigns Are Live' : 'Email Campaigns Unlock Once Your Domain Is Verified'}</h2><InfoTip text="Each firm has its own domain and sender reputation. The firm is the legal sender. Text campaigns arrive with texting." label="About campaign setup" /></div>
        {emailOk ? <button className="btn" type="button" onClick={() => navigate('/dashboard/campaigns')}>Open Campaigns</button> : <span className="tag">Verify your domain below</span>}
      </div>
      <DomainSetup key={f.domain} firm={f} />
      <EmailDesign firm={f} />
    </>
  )
}
