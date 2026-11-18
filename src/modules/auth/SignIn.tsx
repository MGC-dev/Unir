import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import type { EmailOtpType } from '@supabase/supabase-js'
import { useAuth } from '../../app/auth'
import { signupAllowed } from '../../lib/supabase'
import { IconBellRinging, IconCalendarEvent, IconSignature } from '@tabler/icons-react'
import '@fontsource-variable/geist'
import { SignInPage, type SignInMode } from '@/components/ui/sign-in'
import { HalftoneU } from '../../shared/HalftoneU'

/** White page; buttons and links in the sidebar's navy. */
const SURFACE = { '--background': '#ffffff', '--primary': '#0f2347', '--ring': 'rgba(15,35,71,.35)' } as CSSProperties

const COPY: Record<SignInMode, { title: string; description: string }> = {
  'sign-in': { title: 'Welcome back', description: 'Sign in to your firm’s workspace to pick up every enquiry where you left it.' },
  create: { title: 'Create your account', description: 'Start with your own details. You’ll add your firm and invite your team next.' },
  reset: { title: 'Reset your password', description: 'Enter the email you sign in with and we’ll send you a link to choose a new password.' },
  'set-password': { title: 'Choose a password', description: 'Pick a new password for your account. You’ll use it with your email to sign in.' },
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
 * Sign in, create an account, reset a password, or choose a new one after a reset or invite link (`?set-password`).
 * With Supabase keys in .env.local these use real accounts; without them (demo mode) signing in opens the sample portal.
 * Accounts are by invite only unless VITE_ALLOW_SIGNUP is "true".
 */
export default function SignIn() {
  const navigate = useNavigate()
  const { search, state } = useLocation()
  const auth = useAuth()
  const fromUrl: SignInMode = search.includes('set-password') ? 'set-password' : search.includes('create') ? 'create' : search.includes('reset') ? 'reset' : 'sign-in'
  const [mode, setMode] = useState<SignInMode>(fromUrl)
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' }>()
  const [busy, setBusy] = useState(false)
  useEffect(() => { setMode(fromUrl); setMessage(undefined) }, [fromUrl])
  useEffect(() => { document.title = `${{ create: 'Create account', reset: 'Reset password', 'set-password': 'Choose a password', 'sign-in': 'Sign in' }[mode]} · UNIR`; return () => { document.title = 'UNIR' } }, [mode])

  // Invite and reset emails link here with ?set-password&token_hash=…&type=invite|recovery: sign in with the token first.
  const [linking, setLinking] = useState(() => new URLSearchParams(search).has('token_hash'))
  useEffect(() => {
    const q = new URLSearchParams(search), hash = q.get('token_hash'), type = q.get('type') as EmailOtpType | null
    if (!hash || !type || !auth.enabled) { setLinking(false); return }
    auth.verifyLink(hash, type)
      .catch(() => setMessage({ text: 'This link has expired or was already used. Ask for a new one.', tone: 'error' }))
      .finally(() => { setLinking(false); navigate('/sign-in?set-password', { replace: true }) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (m: SignInMode) => navigate(m === 'sign-in' ? '/sign-in' : `/sign-in?${m}`)
  const back = (state as { from?: string } | null)?.from || '/'
  const canCreate = !auth.enabled || signupAllowed

  // Already signed in: go to the portal (except while choosing a new password).
  if (auth.enabled && !auth.loading && auth.session && mode !== 'set-password') return <Navigate to={back} replace />
  if (auth.enabled && (auth.loading || linking)) return null
  if (mode === 'create' && !canCreate) return <Navigate to="/sign-in" replace />

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage(undefined)
    try { await fn() } catch (e) { setMessage({ text: e instanceof Error ? e.message : 'Something went wrong. Try again.', tone: 'error' }) } finally { setBusy(false) }
  }

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    if (!auth.enabled) { // demo mode: no real accounts
      if (mode === 'reset') setMessage({ text: 'If that email has an account, a reset link is on its way.', tone: 'info' })
      else navigate('/')
      return
    }
    run(async () => {
      if (mode === 'sign-in') { await auth.signIn(f.email, f.password, !!f.rememberMe); navigate(back, { replace: true }) }
      else if (mode === 'reset') { await auth.sendReset(f.email); setMessage({ text: 'If that email has an account, a reset link is on its way. It works once.', tone: 'info' }) }
      else if (mode === 'set-password') {
        if (!auth.session) throw new Error('This link has expired or was already used. Ask for a new one.')
        if (f.password !== f.confirm) throw new Error('The two passwords don’t match.')
        await auth.setPassword(f.password); navigate('/', { replace: true })
      } else {
        const { confirm } = await auth.signUp(f.name, f.email, f.password)
        if (confirm) setMessage({ text: 'Check your email to confirm your account, then sign in.', tone: 'info' })
        else navigate('/', { replace: true })
      }
    })
  }

  return (
    <div className="ai-surface" style={SURFACE}>
      <SignInPage
        key={mode}
        mode={mode}
        logo={<Logo />}
        title={<span className="font-medium tracking-tight">{COPY[mode].title}</span>}
        description={COPY[mode].description}
        message={message?.text}
        messageTone={message?.tone}
        busy={busy}
        allowCreate={canCreate}
        aside={<Aside />}
        notes={[
          { icon: <IconBellRinging size={20} />, title: 'New enquiry', text: 'Family law · from your website form, 2 min ago' },
          { icon: <IconCalendarEvent size={20} />, title: 'Consultation booked', text: 'Tomorrow at 10:00 AM with Priya' },
          { icon: <IconSignature size={20} />, title: 'Engagement letter signed', text: 'Moved to Signed on the pipeline' },
        ]}
        onSignIn={submit}
        onGoogleSignIn={() => (auth.enabled ? run(auth.signInWithGoogle) : navigate('/'))}
        onResetPassword={() => go('reset')}
        onCreateAccount={() => go('create')}
        onBackToSignIn={() => go('sign-in')}
      />
    </div>
  )
}
