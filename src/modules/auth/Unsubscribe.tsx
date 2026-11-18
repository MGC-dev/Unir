// The page behind the "Unsubscribe" link in campaign emails. Public: the link's token is the only key. It shows the
// firm's name (never the lead's details), and opts the person out when they confirm. Email programs' own Unsubscribe
// button skips this page and calls the `unsubscribe` function directly.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

type State = { kind: 'loading' } | { kind: 'ask'; firm: string } | { kind: 'done'; firm: string } | { kind: 'error'; text: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function Unsubscribe() {
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) { setState({ kind: 'error', text: 'Unsubscribing isn’t available on this demo.' }); return }
    if (!UUID.test(token)) { setState({ kind: 'error', text: 'This unsubscribe link isn’t complete. Try the link in the email again.' }); return }
    supabase.rpc('unsubscribe_info', { t: token }).then(({ data, error }) => {
      if (error) setState({ kind: 'error', text: 'We couldn’t check this link right now. Try again in a minute.' })
      else if (!data) setState({ kind: 'error', text: 'This unsubscribe link has expired or isn’t valid.' })
      else setState(data.done ? { kind: 'done', firm: data.firm } : { kind: 'ask', firm: data.firm })
    })
  }, [token])

  const confirm = async () => {
    if (!supabase) return
    setBusy(true)
    const { data, error } = await supabase.rpc('unsubscribe_by_token', { t: token })
    setBusy(false)
    if (error || !data) setState({ kind: 'error', text: 'That didn’t go through. Try again in a minute.' })
    else setState({ kind: 'done', firm: data.firm })
  }

  return (
    <main className="unsub">
      <div className="unsub__card">
        {state.kind === 'loading' && <p className="unsub__text">Checking your link…</p>}
        {state.kind === 'ask' && <>
          <h1 className="unsub__title">Unsubscribe from {state.firm}?</h1>
          <p className="unsub__text">You’ll stop getting campaign emails and automatic messages from {state.firm}. Replies to anything you send them aren’t affected.</p>
          <button className="unsub__btn" onClick={confirm} disabled={busy}>{busy ? 'Unsubscribing…' : 'Unsubscribe'}</button>
        </>}
        {state.kind === 'done' && <>
          <h1 className="unsub__title">You’re unsubscribed</h1>
          <p className="unsub__text">{state.firm} won’t send you campaign emails or automatic messages any more. If this was a mistake, contact {state.firm} directly.</p>
        </>}
        {state.kind === 'error' && <>
          <h1 className="unsub__title">Something’s not right</h1>
          <p className="unsub__text">{state.text}</p>
        </>}
      </div>
    </main>
  )
}
