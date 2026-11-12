import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  IconArrowRight, IconArrowUpRight, IconBrandGoogle, IconBrandLinkedin, IconBrandWindows, IconBrandX, IconBrandYoutube, IconBrandZapier,
  IconCheck, IconListDetails, IconAdjustmentsHorizontal, IconChartBar, IconClockHour9, IconDeviceMobileMessage, IconForms, IconHandStop,
  IconLifebuoy, IconMenu2, IconMessage2, IconPhoneCall, IconPlus, IconScale, IconShieldLock, IconSignature, IconSparkles,
  IconX, IconAd2, IconMail,
} from '@tabler/icons-react'
import '@fontsource-variable/geist'
import { HalftoneU } from '../../shared/HalftoneU'
import './landing.css'

/* ------------------------------------------------------------------ small parts */

/** Where "Book a walkthrough" goes. Placeholder until there is a booking link. */
const BOOKING = '#cta'

const Eyebrow = ({ children, dark }: { children: ReactNode; dark?: boolean }) => <p className={`lp-eyebrow${dark ? ' lp-eyebrow--dark' : ''}`}><i aria-hidden="true" />{children}</p>
const Mark = () => (
  <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true"><rect width="64" height="64" rx="14" fill="currentColor" /><path d="M20 16v21a12 12 0 0 0 24 0V16" fill="none" stroke="var(--lp-bg)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /><rect x="20" y="50" width="24" height="3" rx="1.5" fill="#d4a954" /></svg>
)
const Logo = () => <Link to="/welcome" className="lp-logo"><Mark /><span>UNIR</span></Link>

const SOURCES: [typeof IconForms, string][] = [
  [IconForms, 'Website forms'], [IconAd2, 'Google Ads'], [IconPhoneCall, 'CallRail'], [IconBrandZapier, 'Zapier'],
  [IconDeviceMobileMessage, 'RingCentral'], [IconBrandGoogle, 'Google Calendar'], [IconBrandWindows, 'Microsoft Outlook'], [IconMail, 'Email'],
]

/* ------------------------------------------------------------------ capability cards (drawn, not photographed) */

function MiniPipeline() {
  const cols = [['New', 3, '#61729d'], ['Contacted', 2, '#4a6fd1'], ['Consult', 2, '#8f6e2c'], ['Signed', 1, '#278462']] as const
  return (
    <div className="mini mini--pipe">
      {cols.map(([n, k, c]) => (
        <div key={n}><b style={{ background: c }}>{n}</b>{Array.from({ length: k }, (_, i) => <span key={i}><i /><i /></span>)}</div>
      ))}
    </div>
  )
}
const MiniTexts = () => (
  <div className="mini mini--sms">
    <p className="in">Hi, I need help with a custody question.</p>
    <p className="out">Thanks Rachel. Could you talk at 2:30 today?</p>
    <p className="in">Yes, 2:30 works.</p>
  </div>
)
const MiniCal = () => (
  <div className="mini mini--cal">
    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d, i) => (
      <div key={d}><small>{d}</small>{i === 1 && <b style={{ background: '#1f4fd8', top: 18 }}>Call</b>}{i === 2 && <b style={{ background: '#6d28d9', top: 44, height: 40 }}>Consult</b>}{i === 4 && <b style={{ background: '#b91c1c', top: 24 }}>Filing</b>}{i === 0 && <b style={{ background: '#0f766e', top: 60 }}>Follow-up</b>}</div>
    ))}
  </div>
)
const MiniDoc = () => (
  <div className="mini mini--doc">
    <div><i /><i /><i /><i className="short" /><span className="sig">R. Alvarez</span><em>Signed</em></div>
  </div>
)
const MiniAgent = () => (
  <div className="mini mini--ai">
    <span className="orb" />
    <p>3 new enquiries overnight. I texted each one and booked Maria for 10 AM.</p>
  </div>
)

const CAPS = [
  { t: 'Lead pipeline', d: 'Every enquiry on one board, from first contact to signed client, with the next step on each card.', art: <MiniPipeline /> },
  { t: 'Texts & email', d: 'Reply from the portal, or let campaigns follow up on their own. Opt-in and STOP handled for you.', art: <MiniTexts /> },
  { t: 'Calendar & tasks', d: 'Calls, consultations, follow-ups and deadlines, assigned and on one shared calendar.', art: <MiniCal /> },
  { t: 'Documents & e-sign', d: 'Send engagement letters and intake forms, and see the moment they’re signed.', art: <MiniDoc /> },
  { t: 'AI agents', d: 'Agents that answer after hours, sort new enquiries and draft the follow-up for you to approve.', art: <MiniAgent /> },
]

/** Examples only: each firm sets its own practice areas and services. */
const AREAS = ['Family law', 'Personal injury', 'Immigration', 'Estate planning', 'Business law', 'Employment', 'Criminal defence', 'Real estate',
  'Wills & probate', 'Bankruptcy', 'Tax', 'Intellectual property', 'Landlord & tenant', 'Medical negligence', 'Debt recovery', 'Mediation']

const FITS = [
  { I: IconListDetails, t: 'Your services, your names', d: 'Add every service you offer, from a single consultation to a full matter, and price each one your way.' },
  { I: IconAdjustmentsHorizontal, t: 'The right questions for each', d: 'Custom fields per practice area, so an immigration enquiry and a divorce enquiry each capture what you need.' },
  { I: IconChartBar, t: 'See what each one brings in', d: 'Reports by practice area and service show which work, and which lead sources, actually turn into clients.' },
]

const STEPS = [
  ['Enquiry', 'A form, ad or tracked call creates the lead and tells the right person.'],
  ['Contacted', 'A text goes out within minutes, in business hours or after.'],
  ['Consultation', 'Booked on the shared calendar, with a reminder the day before.'],
  ['Contract sent', 'The engagement letter goes out for e-signature from the lead’s ticket.'],
  ['Signed', 'The client is yours. Reports show which source brought them in.'],
] as const

const TRUST: [typeof IconCheck, string][] = [
  [IconHandStop, 'Opt-in and STOP handled'], [IconClockHour9, 'Quiet hours, 8 AM–9 PM'], [IconShieldLock, 'Each firm’s data kept apart'],
  [IconDeviceMobileMessage, 'Registered business texting'], [IconScale, 'Your firm is the sender'],
]

const FAQ = [
  ['What is UNIR?', 'UNIR is the intake portal for law firms. It brings every new enquiry into one place, follows up by text and email, books consultations and sends the contract for signature, so fewer leads are lost between first contact and a signed client.'],
  ['Where do leads come from?', 'Your website forms, Google Ads and tracked calls (CallRail, including through Zapier). Texts can run through your firm’s own number, including RingCentral. New sources can be added from the Integrations page.'],
  ['Does it replace our practice management software?', 'No. UNIR covers intake: from enquiry to signed client. Matters, billing and trust accounting stay where they are today.'],
  ['Who owns the data?', 'Your firm does. Each firm has its own workspace, invites its own team and sets who can see what. Your data is kept apart from every other firm’s.'],
  ['Are texts compliant?', 'Texts only go to people who opted in, STOP works straight away, and nothing is sent outside 8 AM to 9 PM in the contact’s time zone. Messages wait until your number is verified rather than being dropped.'],
  ['Can we try it first?', 'Yes. Open the demo workspace to click through the pipeline, calendar and campaigns with sample data, or book a walkthrough with us.'],
]

/* ------------------------------------------------------------------ page */

export default function Landing() {
  const [menu, setMenu] = useState(false)
  const [open, setOpen] = useState<number | null>(0)
  const [cap, setCap] = useState(0)
  useEffect(() => { document.title = 'UNIR — Intake for law firms'; return () => { document.title = 'UNIR' } }, [])

  const nav = [['Product', '#product'], ['How it works', '#how'], ['Integrations', '#integrations'], ['FAQ', '#faq']]

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav__row">
          <Logo />
          <nav className="lp-nav__links" aria-label="Main">{nav.map(([l, h]) => <a key={h} href={h}>{l}</a>)}</nav>
          <div className="lp-nav__end">
            <Link to="/sign-in" className="lp-link">Sign in</Link>
            <Link to="/sign-in?create" className="lp-btn lp-btn--sm">Get started</Link>
            <button type="button" className="lp-nav__menu" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} onClick={() => setMenu(m => !m)}>{menu ? <IconX size={20} /> : <IconMenu2 size={20} />}</button>
          </div>
        </div>
        {menu && <nav className="lp-nav__sheet" aria-label="Main">{nav.map(([l, h]) => <a key={h} href={h} onClick={() => setMenu(false)}>{l}</a>)}<Link to="/sign-in">Sign in</Link></nav>}
      </header>

      <main>
        {/* hero */}
        <section className="lp-hero">
          <HalftoneU className="lp-hero__art" />
          <div className="lp-wrap lp-hero__row">
            <h1>Every enquiry, from first call to signed client</h1>
            <div className="lp-hero__side">
              <p>UNIR brings your firm’s new leads into one place, follows up by text and email within minutes, books the consultation and sends the contract for signature.</p>
              <div className="lp-actions">
                <Link to="/" className="lp-btn">Open the demo <IconArrowRight size={16} /></Link>
                <a href={BOOKING} className="lp-btn lp-btn--ghost">Book a walkthrough</a>
              </div>
            </div>
          </div>
        </section>

        {/* sources */}
        <section className="lp-strip" aria-label="Where leads come from">
          <p className="lp-wrap lp-strip__lead">Leads arrive from the tools <b>your firm already uses</b></p>
          <div className="lp-marquee"><div className="lp-marquee__track">
            {[0, 1].map(k => SOURCES.map(([I, n]) => <span key={k + n} aria-hidden={k === 1 || undefined}><I size={20} stroke={1.6} />{n}</span>))}
          </div></div>
        </section>

        {/* value */}
        <section className="lp-value lp-wrap">
          <h2 className="lp-statement">One portal that <u>captures</u>, <u>follows up</u>, and <u>signs</u> every new client — even after the office closes</h2>
          <div className="lp-grid3">
            {[
              [IconForms, 'Captures every enquiry', 'Forms, ads and tracked calls land on one board with their source, practice area and owner.'],
              [IconMessage2, 'Follows up for you', 'Texts and emails go out on time, stop when someone replies, and never break quiet hours.'],
              [IconSignature, 'Turns consults into contracts', 'Book the consultation, send the engagement letter and see when it’s signed.'],
            ].map(([I, t, d]) => { const Ico = I as typeof IconForms; return (
              <div key={t as string} className="lp-cell"><Ico size={22} stroke={1.5} /><h3>{t as string}</h3><p>{d as string}</p></div>
            ) })}
          </div>
        </section>

        {/* capabilities */}
        <section id="product" className="lp-section">
          <div className="lp-wrap lp-head">
            <div><Eyebrow>Product</Eyebrow><h2>Everything intake needs, in one place</h2></div>
            <Link to="/" className="lp-btn lp-btn--ghost">Explore the portal <IconArrowUpRight size={16} /></Link>
          </div>
          <div className="lp-wrap lp-caps">
            {CAPS.map((c, i) => (
              <article key={c.t} className={`lp-cap${cap === i ? ' is-open' : ''}`} onMouseEnter={() => setCap(i)}>
                <button type="button" className="lp-cap__toggle" aria-expanded={cap === i} aria-label={`${c.t}: show details`} onClick={() => setCap(i)}><IconPlus size={16} /></button>
                <div className="lp-cap__art">{c.art}</div>
                <div className="lp-cap__text"><h3>{c.t}</h3><p>{c.d}</p></div>
              </article>
            ))}
          </div>
        </section>

        {/* practice areas and services */}
        <section id="practice" className="lp-section">
          <div className="lp-wrap lp-fit">
            <div>
              <Eyebrow>Practice areas</Eyebrow>
              <h2>Fits every service your firm offers</h2>
              <p className="lp-muted lp-fit__lead">Set up the practice areas and services you actually sell. A family firm, a busy PI practice and a full-service firm all run on the same portal.</p>
            </div>
            <ul className="lp-areas" aria-label="Examples of practice areas">
              {AREAS.map(a => <li key={a}>{a}</li>)}
              <li className="lp-areas__add"><IconPlus size={14} stroke={2.2} />Add your own</li>
            </ul>
          </div>
          <div className="lp-wrap"><div className="lp-grid3">
            {FITS.map(({ I, t, d }) => <div key={t} className="lp-cell"><I size={22} stroke={1.5} /><h3>{t}</h3><p>{d}</p></div>)}
          </div></div>
        </section>

        {/* dark: integrations, security, support */}
        <section id="integrations" className="lp-dark">
          <div className="lp-wrap">
            <div className="lp-dark__wide">
              <div>
                <Eyebrow dark>Integrations</Eyebrow>
                <h2>Connects to the tools you already pay for</h2>
                <p>Website forms, Google Ads, CallRail through Zapier, RingCentral for texting, and Google or Outlook calendars. New leads arrive with their source, so you know which ads pay for themselves.</p>
              </div>
              <div className="lp-tiles" aria-hidden="true">
                {[IconForms, IconAd2, IconPhoneCall, IconBrandZapier, IconDeviceMobileMessage, IconBrandGoogle, IconBrandWindows, IconMail, IconSparkles].map((I, i) => <span key={i} style={{ animationDelay: `${i * 0.35}s` }}><I size={24} stroke={1.5} /></span>)}
              </div>
            </div>
            <div className="lp-dark__pair">
              <div><Eyebrow dark>Security</Eyebrow><IconShieldLock className="lp-dark__icon" size={40} stroke={1.2} /><h3>Your firm’s data stays your firm’s</h3><p>Every firm has its own workspace, invites its own people and decides who sees what. Records are separated at the database, not just in the screens.</p></div>
              <div><Eyebrow dark>Support</Eyebrow><IconLifebuoy className="lp-dark__icon" size={40} stroke={1.2} /><h3>Set up with people who know intake</h3><p>We help you connect your sources, register your texting number and build your first follow-up campaign.</p></div>
            </div>
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="lp-section">
          <div className="lp-wrap lp-head"><div><Eyebrow>How it works</Eyebrow><h2>From enquiry to signed, without the gaps</h2></div></div>
          <ol className="lp-wrap lp-steps">
            {STEPS.map(([t, d], i) => <li key={t}><span className="lp-steps__n">{String(i + 1).padStart(2, '0')}</span><h3>{t}</h3><p>{d}</p></li>)}
          </ol>
        </section>

        {/* trust */}
        <section className="lp-trust" aria-label="Texting and data safeguards">
          <ul className="lp-wrap">{TRUST.map(([I, t]) => <li key={t}><I size={22} stroke={1.5} />{t}</li>)}</ul>
        </section>

        {/* faq */}
        <section id="faq" className="lp-section">
          <div className="lp-wrap lp-faq">
            <div><Eyebrow>FAQ</Eyebrow><h2>Frequently asked questions</h2><p className="lp-muted">Can’t find what you need? Book a walkthrough and ask us directly.</p></div>
            <div className="lp-faq__list">
              {FAQ.map(([q, a], i) => (
                <div key={q} className={`lp-faq__item${open === i ? ' is-open' : ''}`}>
                  <h3><button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{q}<span aria-hidden="true"><IconPlus size={16} /></span></button></h3>
                  <div className="lp-faq__a"><p>{a}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* cta */}
        <section id="cta" className="lp-cta">
          <div className="lp-wrap">
            <Eyebrow>Get started</Eyebrow>
            <h2>Ready to stop losing new clients?</h2>
            <div className="lp-actions lp-actions--center">
              <Link to="/" className="lp-btn">Open the demo <IconArrowRight size={16} /></Link>
              {/* TODO: point at the firm’s booking link */}
              <a href={BOOKING} className="lp-btn lp-btn--ghost">Book a walkthrough</a>
            </div>
            <p className="lp-muted lp-small">Your firm’s workspace · your number · your data</p>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap">
          <div className="lp-foot__top">
            <div><Logo /><p>The intake portal that helps law firms answer, follow up and sign every new client.</p></div>
            <form className="lp-foot__news" onSubmit={e => e.preventDefault()}>
              <h3>Stay up to date</h3><p>Product updates and intake tips, once a month.</p>
              <div><label className="sr-only" htmlFor="lp-email">Email</label><input id="lp-email" type="email" placeholder="Enter your email" autoComplete="email" /><button type="submit" className="lp-btn lp-btn--light">Subscribe</button></div>
            </form>
          </div>
          <div className="lp-foot__cols">
            {[
              ['Product', [['Pipeline', '#product'], ['Campaigns', '#product'], ['Calendar', '#product'], ['AI agents', '#product']]],
              ['For firms', [['Practice areas', '#practice'], ['Services', '#practice'], ['Lead sources', '#integrations'], ['Security', '#integrations']]],
              ['Company', [['How it works', '#how'], ['Integrations', '#integrations'], ['FAQ', '#faq'], ['Contact', '#cta']]],
              ['Account', [['Sign in', '/sign-in'], ['Create account', '/sign-in?create'], ['Reset password', '/sign-in?reset'], ['Open the demo', '/']]],
            ].map(([h, links]) => (
              <div key={h as string}><h4>{h as string}</h4><ul>{(links as string[][]).map(([l, href]) => <li key={l}>{href.startsWith('/') ? <Link to={href}>{l}</Link> : <a href={href}>{l}</a>}</li>)}</ul></div>
            ))}
          </div>
          <div className="lp-foot__base">
            <span>© 2026 UNIR. All rights reserved.</span>
            <nav aria-label="Legal"><a href="#">Privacy</a><a href="#">Terms</a><a href="#">Security</a><a href="#">Cookies</a></nav>
            <div className="lp-foot__social">
              {([[IconBrandX, 'X'], [IconBrandLinkedin, 'LinkedIn'], [IconBrandYoutube, 'YouTube']] as const).map(([I, n]) => <a key={n} href="#" aria-label={n}><I size={18} /></a>)}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

