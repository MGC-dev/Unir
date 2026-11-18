import React, { useState } from 'react'
import { IconEye, IconEyeOff } from '@tabler/icons-react'

// --- HELPER COMPONENTS (ICONS) ---

const GoogleIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s12-5.373 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.611-7.743z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z" />
  </svg>
)

// --- TYPE DEFINITIONS ---

/** A small floating card over the right-hand panel (a product moment, not a quote). */
export interface SignInNote {
  icon: React.ReactNode
  title: string
  text: string
}

/** set-password: choosing a new password after a reset or invite link. */
export type SignInMode = 'sign-in' | 'create' | 'reset' | 'set-password'

interface SignInPageProps {
  mode?: SignInMode
  title?: React.ReactNode
  description?: React.ReactNode
  /** A photo for the right-hand panel. */
  heroImageSrc?: string
  /** Or anything else for the right-hand panel (shown when there is no photo). */
  aside?: React.ReactNode
  notes?: SignInNote[]
  /** Shown above the form, for example "Check your email". */
  message?: React.ReactNode
  /** How the message reads: a note (default) or a problem to fix. */
  messageTone?: 'info' | 'error'
  /** While a request is running: the main button is disabled and says so. */
  busy?: boolean
  /** Show the "Create an account" link. Off when accounts are by invite only. */
  allowCreate?: boolean
  logo?: React.ReactNode
  onSignIn?: (event: React.FormEvent<HTMLFormElement>) => void
  onGoogleSignIn?: () => void
  onResetPassword?: () => void
  onCreateAccount?: () => void
  onBackToSignIn?: () => void
}

// --- SUB-COMPONENTS ---

const GlassInputWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-1.5 rounded-2xl border border-border bg-foreground/[0.03] backdrop-blur-sm transition-colors focus-within:border-primary/60 focus-within:bg-primary/[0.05]">
    {children}
  </div>
)

const Field = ({ label, delay, children }: { label: string; delay: string; children: React.ReactNode }) => (
  <div className={`animate-element ${delay}`}>
    <label className="block text-sm font-medium text-muted-foreground">{label}<GlassInputWrapper>{children}</GlassInputWrapper></label>
  </div>
)

const inputCls = 'w-full bg-transparent text-[15px] p-4 rounded-2xl text-foreground placeholder:text-muted-foreground/70 focus:outline-none'

const NoteCard = ({ note, delay }: { note: SignInNote; delay: string }) => (
  <div className={`animate-testimonial ${delay} flex items-start gap-3 rounded-3xl bg-white/10 backdrop-blur-xl border border-white/15 p-5 w-64 text-white`}>
    <span className="grid h-10 w-10 flex-none place-items-center rounded-2xl bg-white/15">{note.icon}</span>
    <div className="text-sm leading-snug">
      <p className="font-medium">{note.title}</p>
      <p className="mt-1 text-white/75">{note.text}</p>
    </div>
  </div>
)

// --- MAIN COMPONENT ---

export const SignInPage: React.FC<SignInPageProps> = ({
  mode = 'sign-in',
  title = <span className="font-light text-foreground tracking-tighter">Welcome</span>,
  description = 'Access your account and continue your journey with us',
  heroImageSrc,
  aside,
  notes = [],
  message,
  messageTone = 'info',
  busy = false,
  allowCreate = true,
  logo,
  onSignIn,
  onGoogleSignIn,
  onResetPassword,
  onCreateAccount,
  onBackToSignIn,
}) => {
  const [showPassword, setShowPassword] = useState(false)
  const link = 'font-medium text-primary hover:underline transition-colors'

  const password = (name: string, label: string, delay: string, autoComplete: string) => (
    <Field label={label} delay={delay}>
      <span className="relative block">
        <input name={name} type={showPassword ? 'text' : 'password'} required minLength={mode === 'sign-in' ? undefined : 8} autoComplete={autoComplete}
          placeholder={mode === 'sign-in' ? 'Enter your password' : 'At least 8 characters'} className={`${inputCls} pr-12`} />
        <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
          className="absolute inset-y-0 right-3 flex items-center rounded-lg px-1 text-muted-foreground hover:text-foreground transition-colors">
          {showPassword ? <IconEyeOff className="w-5 h-5" stroke={1.7} /> : <IconEye className="w-5 h-5" stroke={1.7} />}
        </button>
      </span>
    </Field>
  )

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row font-geist w-full bg-background text-foreground">
      {/* Left column: the form */}
      <section className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">
          {logo && <div className="animate-element mb-10">{logo}</div>}
          <div className="flex flex-col gap-6">
            <h1 className="animate-element animate-delay-100 text-4xl md:text-5xl font-semibold leading-tight">{title}</h1>
            <p className="animate-element animate-delay-200 text-muted-foreground">{description}</p>
            {message && <div role={messageTone === 'error' ? 'alert' : 'status'} className={'animate-element rounded-2xl border px-4 py-3 text-sm text-foreground ' + (messageTone === 'error' ? 'border-[#c23a45]/35 bg-[#c23a45]/[0.06]' : 'border-primary/25 bg-primary/[0.06]')}>{message}</div>}

            <form className="space-y-5" onSubmit={onSignIn}>
              {mode === 'create' && (
                <>
                  <Field label="Your name" delay="animate-delay-300"><input name="name" required autoComplete="name" placeholder="Sarah Mitchell" className={inputCls} /></Field>
                </>
              )}
              {mode === 'set-password' ? (
                <>
                  {password('password', 'New password', 'animate-delay-300', 'new-password')}
                  {password('confirm', 'Confirm new password', 'animate-delay-400', 'new-password')}
                </>
              ) : (
                <>
                  <Field label="Email address" delay="animate-delay-300">
                    <input name="email" type="email" required autoComplete="email" placeholder="you@yourfirm.com" className={inputCls} />
                  </Field>
                  {mode !== 'reset' && password('password', 'Password', 'animate-delay-400', mode === 'create' ? 'new-password' : 'current-password')}
                </>
              )}

              {mode === 'sign-in' && (
                <div className="animate-element animate-delay-500 flex items-center justify-between text-sm">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" name="rememberMe" defaultChecked className="custom-checkbox" />
                    <span className="text-foreground/90">Keep me signed in</span>
                  </label>
                  <a href="#" onClick={e => { e.preventDefault(); onResetPassword?.() }} className={link}>Reset password</a>
                </div>
              )}

              <button type="submit" disabled={busy} aria-busy={busy} className="animate-element animate-delay-600 w-full rounded-2xl bg-primary py-4 font-medium text-primary-foreground hover:bg-[#1a3566] active:scale-[.99] transition disabled:opacity-60 disabled:pointer-events-none">
                {busy ? 'One moment…' : mode === 'create' ? 'Create account' : mode === 'reset' ? 'Send reset link' : mode === 'set-password' ? 'Save password' : 'Sign in'}
              </button>
            </form>

            {(mode === 'sign-in' || mode === 'create') && onGoogleSignIn && (
              <>
                <div className="animate-element animate-delay-700 relative flex items-center justify-center">
                  <span className="w-full border-t border-border" />
                  <span className="px-4 text-sm text-muted-foreground bg-background absolute">Or continue with</span>
                </div>
                <button type="button" onClick={onGoogleSignIn} className="animate-element animate-delay-800 w-full flex items-center justify-center gap-3 border border-border bg-card rounded-2xl py-4 font-medium hover:bg-muted transition-colors">
                  <GoogleIcon />
                  Continue with Google
                </button>
              </>
            )}

            <p className="animate-element animate-delay-900 text-center text-sm text-muted-foreground">
              {mode === 'sign-in'
                ? allowCreate
                  ? <>New to UNIR? <a href="#" onClick={e => { e.preventDefault(); onCreateAccount?.() }} className={link}>Create an account</a></>
                  : <>New to UNIR? Ask your firm’s admin for an invite.</>
                : <>{mode === 'create' ? 'Already have an account?' : 'Remembered it?'} <a href="#" onClick={e => { e.preventDefault(); onBackToSignIn?.() }} className={link}>Sign in</a></>}
            </p>
          </div>
        </div>
      </section>

      {/* Right column: photo or artwork, with notes */}
      {(heroImageSrc || aside) && (
        <section className="hidden md:block flex-1 relative p-4 md:sticky md:top-0 md:h-[100dvh]">
          <div className="animate-slide-right animate-delay-300 absolute inset-4 overflow-hidden rounded-3xl bg-cover bg-center" style={heroImageSrc ? { backgroundImage: `url(${heroImageSrc})` } : undefined}>
            {!heroImageSrc && aside}
          </div>
          {notes.length > 0 && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4 px-8 w-full justify-center">
              <NoteCard note={notes[0]} delay="animate-delay-1000" />
              {notes[1] && <div className="hidden xl:flex"><NoteCard note={notes[1]} delay="animate-delay-1200" /></div>}
              {notes[2] && <div className="hidden 2xl:flex"><NoteCard note={notes[2]} delay="animate-delay-1400" /></div>}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
