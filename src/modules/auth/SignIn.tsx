import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { IconBellRinging, IconCalendarEvent, IconSignature } from '@tabler/icons-react'
import '@fontsource-variable/geist'
import { SignInPage, type SignInMode } from '@/components/ui/sign-in'
import { HalftoneU } from '../../shared/HalftoneU'

const COPY: Record<SignInMode, { title: string; description: string }> = {
  'sign-in': { title: 'Welcome back', description: 'Sign in to your firm’s workspace to pick up every enquiry where you left it.' },
  create: { title: 'Create your workspace', description: 'Set up UNIR for your firm. You can invite your team once you’re in.' },
  reset: { title: 'Reset your password', description: 'Enter the email you sign in with and we’ll send you a link to choose a new password.' },
}

const Logo = () => (
  <Link to="/welcome" className="inline-flex items-center gap-2.5 text-[15px] font-bold tracking-[.14em] text-[#0f2347]">
    <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#0f2347" /><path d="M20 16v21a12 12 0 0 0 24 0V16" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /><rect x="20" y="50" width="24" height="3" rx="1.5" fill="#d4a954" /></svg>
    UNIR
  </Link>
)

/** The navy panel on the right: the dotted U, and a line about what's waiting. */
const Aside = () => (
  <div className="relative h-full w-full bg-[#0f2347]">
    <HalftoneU className="absolute inset-0 h-full w-full" rgb="255,255,255" alpha={[0.06, 0.5]} />
    <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-[#0f2347] via-[#0f2347]/85 to-transparent" />
    <p className="absolute left-10 top-10 max-w-sm text-2xl font-medium leading-snug tracking-tight text-white">
      Every enquiry, from first call to signed client.
    </p>
  </div>
)

/**
 * Sign in, create a workspace, or reset a password. `?create` and `?reset` open those modes.
 * Not wired to real accounts yet: signing in opens the demo portal.
 */
export default function SignIn() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const fromUrl: SignInMode = search.includes('create') ? 'create' : search.includes('reset') ? 'reset' : 'sign-in'
  const [mode, setMode] = useState<SignInMode>(fromUrl)
  const [message, setMessage] = useState<string>()
  useEffect(() => { setMode(fromUrl); setMessage(undefined) }, [fromUrl])
  useEffect(() => { document.title = `${mode === 'create' ? 'Create account' : mode === 'reset' ? 'Reset password' : 'Sign in'} · UNIR`; return () => { document.title = 'UNIR' } }, [mode])

  const go = (m: SignInMode) => navigate(m === 'sign-in' ? '/sign-in' : `/sign-in?${m}`)

  return (
    <div className="ai-surface">
      <SignInPage
        key={mode}
        mode={mode}
        logo={<Logo />}
        title={<span className="font-medium tracking-tight">{COPY[mode].title}</span>}
        description={COPY[mode].description}
        message={message}
        aside={<Aside />}
        notes={[
          { icon: <IconBellRinging size={20} />, title: 'New enquiry', text: 'Family law · from your website form, 2 min ago' },
          { icon: <IconCalendarEvent size={20} />, title: 'Consultation booked', text: 'Tomorrow at 10:00 AM with Priya' },
          { icon: <IconSignature size={20} />, title: 'Engagement letter signed', text: 'Moved to Signed on the pipeline' },
        ]}
        onSignIn={e => {
          e.preventDefault()
          if (mode === 'reset') { setMessage('If that email has an account, a reset link is on its way.'); return }
          navigate('/')
        }}
        onGoogleSignIn={() => navigate('/')}
        onResetPassword={() => go('reset')}
        onCreateAccount={() => go('create')}
        onBackToSignIn={() => go('sign-in')}
      />
    </div>
  )
}
