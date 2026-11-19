import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { EmailOtpType, Session, User } from '@supabase/supabase-js'
import { appUrl, setRememberMe, supabase } from '../lib/supabase'
import { remote, start as startRemote, stop as stopRemote } from '../api/remote'
import { AUTH, DASHBOARD } from './paths'

export interface Auth {
  /** False in demo mode (no Supabase keys): nobody has to sign in. */
  enabled: boolean
  /** True until the saved session has been read. */
  loading: boolean
  session: Session | null
  user: User | null
  /** The name to show for the signed-in person (their email until they have a name). */
  displayName: string
  initials: string
  /** True after opening a password-reset link: the person must choose a new password. */
  recovering: boolean
  signIn: (email: string, password: string, remember: boolean) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<{ confirm: boolean }>
  signInWithGoogle: () => Promise<void>
  sendReset: (email: string) => Promise<void>
  setPassword: (password: string) => Promise<void>
  /** Signs in from an emailed invite or reset link (token_hash and type in the URL). */
  verifyLink: (tokenHash: string, type: EmailOtpType) => Promise<void>
  signOut: () => Promise<void>
}

const DEMO_NAME = 'Sarah Mitchell'
const initialsOf = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(x => x[0]!.toUpperCase()).join('') || '?'
const need = () => { if (!supabase) throw new Error('Accounts are not set up. Add your Supabase keys to .env.local.'); return supabase }
const fail = (e: { message: string } | null) => { if (e) throw new Error(friendly(e.message)) }
/** Supabase's error messages, said the way a person would. */
function friendly(m: string) {
  if (/invalid login credentials/i.test(m)) return 'That email and password don’t match an account.'
  if (/email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link.'
  if (/signups not allowed|signup is disabled/i.test(m)) return 'Accounts are by invite only. Ask your firm’s admin to invite you.'
  if (/provider is not enabled/i.test(m)) return 'Google sign-in isn’t switched on for this workspace yet.'
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.'
  if (/should be different/i.test(m)) return 'Choose a password you haven’t used here before.'
  if (/password should be at least/i.test(m)) return 'Use at least 8 characters.'
  if (/failed to fetch|network/i.test(m)) return 'Can’t reach the sign-in service. Check your connection.'
  return m
}

const Ctx = createContext<Auth | null>(null)
export const useAuth = () => { const c = useContext(Ctx); if (!c) throw new Error('useAuth outside AuthProvider'); return c }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!!supabase)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Live mode: load the signed-in person's firm, and forget it on sign-out.
  useEffect(() => { if (!supabase) return; if (session) void startRemote(session); else stopRemote() }, [session?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<Auth>(() => {
    const user = session?.user ?? null
    const name = (user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || DEMO_NAME) as string
    return {
      enabled: !!supabase, loading, session, user, recovering,
      displayName: supabase ? name : DEMO_NAME,
      initials: initialsOf(supabase ? name : DEMO_NAME),
      async signIn(email, password, remember) {
        setRememberMe(remember)
        const { error } = await need().auth.signInWithPassword({ email: email.trim(), password }); fail(error)
      },
      async signUp(name, email, password) {
        setRememberMe(true)
        const { data, error } = await need().auth.signUp({ email: email.trim(), password, options: { data: { full_name: name.trim() }, emailRedirectTo: appUrl(DASHBOARD) } }); fail(error)
        return { confirm: !data.session }
      },
      async signInWithGoogle() {
        setRememberMe(true)
        const { error } = await need().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl(DASHBOARD) } }); fail(error)
      },
      async sendReset(email) {
        const { error } = await need().auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl(AUTH['set-password']) }); fail(error)
      },
      async setPassword(password) {
        const { error } = await need().auth.updateUser({ password }); fail(error)
        setRecovering(false)
      },
      async verifyLink(tokenHash, type) {
        setRememberMe(true)
        const { error } = await need().auth.verifyOtp({ token_hash: tokenHash, type }); fail(error)
      },
      async signOut() {
        if (supabase) { const { error } = await supabase.auth.signOut(); fail(error) }
      },
    }
  }, [session, loading, recovering])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Keeps the portal behind sign-in. In demo mode (no Supabase keys) it lets everyone through. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { enabled, loading, session, recovering } = useAuth()
  const location = useLocation()
  if (!enabled) return <>{children}</>
  if (loading) return null
  if (recovering) return <Navigate to={AUTH['set-password']} replace />
  if (!session) return <Navigate to={AUTH['sign-in']} replace state={{ from: location.pathname + location.search }} />
  return <FirmGate>{children}</FirmGate>
}

/** Waits for the firm's data, and explains when the person isn't in a firm yet or the data can't load. */
function FirmGate({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(remote.subscribe, remote.state)
  const { signOut, user } = useAuth()
  if (state === 'ready') return <>{children}</>
  const box = (title: string, text: string, retry?: boolean) => (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#0f2347' }}>
      <div style={{ maxWidth: 420, textAlign: 'center', display: 'grid', gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{title}</h1>
        <p style={{ margin: 0, color: '#5b6478', lineHeight: 1.5 }}>{text}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
          {retry && <button type="button" onClick={() => location.reload()} style={{ padding: '10px 16px', borderRadius: 12, border: 0, background: '#0f2347', color: '#fff', cursor: 'pointer' }}>Try again</button>}
          <button type="button" onClick={() => void signOut()} style={{ padding: '10px 16px', borderRadius: 12, border: '1px solid #dde1e8', background: '#fff', cursor: 'pointer' }}>Sign out</button>
        </div>
      </div>
    </div>
  )
  if (state === 'no-firm') return box('You’re not in a firm yet', `${user?.email ?? 'This account'} is signed in, but no firm has added it yet. Ask your firm’s admin to invite you, or MGC to set your firm up.`)
  if (state === 'error') return box('Couldn’t load your firm', remote.message() || 'Check your connection and try again.', true)
  return <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', color: '#5b6478' }}>Loading your firm…</div>
}
