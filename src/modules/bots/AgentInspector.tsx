import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { botsApi, firmApi, live, useQuery, type BotInput } from '../../api'
import { BOT_ACTIONS, BOT_MODELS, BOT_TOOLS, EXTERNAL_TOOLS, type Bot, type BotModel, type BotRun, type BotSchedule } from '../../api/types'
import { when } from '../../shared/format'
import { cn } from '@/lib/utils'
import { BotAvatar } from './BotAvatar'

const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Johannesburg' } catch { return 'Africa/Johannesburg' } }
const noSchedule = (): BotSchedule => ({ enabled: false, days: [1, 2, 3, 4, 5], time: '08:00', tz: localTz(), to: [] })
const toInput = (a: Bot): BotInput => ({
  name: a.name, description: a.description, instructions: a.instructions, model: a.model, tools: [...a.tools], actions: [...a.actions], external: [...a.external], active: a.active,
  schedule: a.schedule ? { ...a.schedule, days: [...a.schedule.days], to: [...a.schedule.to] } : noSchedule(),
})
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "Weekdays at 08:00", "Every day at 07:30", "Mon, Wed at 09:00". */
const scheduleLabel = (s: BotSchedule) => {
  const d = [...s.days].sort()
  const days = d.length === 7 ? 'Every day' : d.join() === '1,2,3,4,5' ? 'Weekdays' : d.join() === '0,6' ? 'Weekends' : d.map(i => DAYS[i]).join(', ')
  return `${days} at ${s.time}`
}
const EMAIL_NOTE: Record<BotRun['emailStatus'], string> = { none: 'Not emailed', sent: 'Emailed', held: 'Email held', failed: 'Email failed' }
const same = (a: BotInput, b: BotInput) => JSON.stringify(a) === JSON.stringify(b)
const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

/** An on/off switch for a list row. Position and fill both change, so the state never rests on colour alone. */
function Switch({ on, onChange, labelledBy }: { on: boolean; onChange: () => void; labelledBy: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} onClick={onChange}
      className={cn('relative h-[26px] w-[44px] shrink-0 rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ios-accent/50 focus-visible:ring-offset-2 motion-reduce:transition-none',
        on ? 'bg-ios-green' : 'bg-[#e3e3e8]')}>
      <span className={cn('absolute top-[2px] left-[2px] size-[22px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.06)] transition-transform duration-200 motion-reduce:transition-none',
        on && 'translate-x-[18px]')} />
    </button>
  )
}

/** A grouped list: a small heading, rounded white rows with hairline separators, and a footer that explains it. */
function Group({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      {title && <h3 className="px-4 text-[12px] font-medium uppercase tracking-[0.04em] text-ios-secondary">{title}</h3>}
      <div className="overflow-hidden rounded-xl bg-white [&>*+*]:border-t [&>*+*]:border-ios-separator">{children}</div>
      {footer && <p className="px-4 text-[12.5px] leading-[17px] text-ios-secondary">{footer}</p>}
    </section>
  )
}

function SwitchRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: () => void }) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center gap-3 py-2 pr-3 pl-4">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span id={id} className="text-[15px] leading-5 text-ios-label">{label}</span>
        {hint && <span className="text-[12.5px] leading-4 text-ios-secondary">{hint}</span>}
      </div>
      <Switch on={on} onChange={onChange} labelledBy={id} />
    </div>
  )
}

/** Three mutually exclusive choices, side by side. */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-flow-col auto-cols-fr rounded-[9px] bg-ios-field p-[2px]">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={cn('h-7 rounded-[7px] text-[13px] font-medium outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ios-accent/50',
            o.value === value ? 'bg-white text-ios-label shadow-[0_3px_8px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]' : 'text-ios-secondary hover:text-ios-label')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Everything about one agent, beside its chat. Edits stay local until Save; Cancel puts them back.
 * Done closes the inspector when nothing has changed.
 */
export function AgentInspector({ bot, isNew, onClose, onDeleted }: { bot: Bot; isNew?: boolean; onClose: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState<BotInput>(() => toInput(bot))
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const name = useRef<HTMLInputElement>(null)
  const saved = toInput(bot)
  const dirty = !same(draft, saved)
  const set = (patch: Partial<BotInput>) => { setDraft(d => ({ ...d, ...patch })); setError('') }
  const setSchedule = (patch: Partial<BotSchedule>) => setDraft(d => ({ ...d, schedule: { ...d.schedule, ...patch } }))
  const team = useQuery(() => firmApi.team()) ?? []
  const runs = useQuery(() => botsApi.runs(bot.id), [bot.id]) ?? []
  const [running, setRunning] = useState(false)
  const runNow = async () => { setRunning(true); try { await botsApi.runNow(bot.id) } finally { setRunning(false) } }
  const sched = draft.schedule

  // Another agent opened in the same inspector: start from its saved settings.
  useEffect(() => { setDraft(toInput(bot)); setError(''); setConfirming(false) }, [bot.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isNew) name.current?.select() }, [isNew, bot.id])

  const save = async () => {
    if (!draft.name.trim()) { setError('Give the agent a name.'); name.current?.focus(); return }
    if (draft.active && !draft.instructions.trim()) { setError('Write its instructions before making it available in Chat.'); return }
    if (sched.enabled && !draft.active) { setError('Switch on “Available in Chat” too: only agents that are on run by themselves.'); return }
    if (sched.enabled && !sched.days.length) { setError('Pick at least one day for it to run.'); return }
    if (sched.enabled && !draft.instructions.trim()) { setError('Write its instructions so it knows what to report.'); return }
    setSaving(true)
    await botsApi.update(bot.id, { ...draft, name: draft.name.trim() })
    setSaving(false)
  }
  const remove = async () => { await botsApi.remove(bot.id); onDeleted() }

  const toolbarBtn = 'h-8 rounded-lg px-2.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ios-accent/50 disabled:opacity-40'

  return (
    <aside aria-label={`${bot.name} settings`} className="flex h-full min-h-0 flex-col">
      <header className="grid h-[52px] shrink-0 grid-cols-[1fr_auto_1fr] items-center px-2">
        <span>{dirty && <button type="button" className={cn(toolbarBtn, 'text-ios-accent hover:bg-black/[0.04]')} onClick={() => { setDraft(saved); setError('') }}>Cancel</button>}</span>
        <h2 className="text-[15px] font-semibold text-ios-label">Agent settings</h2>
        <span className="flex justify-end">
          {dirty
            ? <button type="button" className={cn(toolbarBtn, 'font-semibold text-ios-accent hover:bg-black/[0.04]')} disabled={saving} onClick={save}>Save</button>
            : <button type="button" className={cn(toolbarBtn, 'font-semibold text-ios-accent hover:bg-black/[0.04]')} onClick={onClose}>Done</button>}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [mask-image:linear-gradient(to_bottom,transparent,black_24px)]">
        <div className="grid gap-6 px-4 pt-6 pb-10">
          <div className="grid justify-items-center gap-3 text-center">
            <BotAvatar bot={bot} size={72} muted={!draft.active} />
            <div className="grid w-full gap-1">
              <input ref={name} aria-label="Agent name" value={draft.name} onChange={e => set({ name: e.target.value })} placeholder="Agent name"
                className="w-full rounded-lg bg-transparent px-2 py-1 text-center text-[22px] font-semibold tracking-[-0.02em] text-ios-label outline-none placeholder:text-ios-tertiary hover:bg-black/[0.03] focus:bg-white focus-visible:ring-2 focus-visible:ring-ios-accent/[0.12]" />
              <textarea aria-label="Description" rows={2} value={draft.description} onChange={e => set({ description: e.target.value })} placeholder="What is this agent for?"
                className="w-full resize-none rounded-lg bg-transparent px-2 py-1 text-center text-[14px] leading-5 text-ios-secondary outline-none placeholder:text-ios-tertiary hover:bg-black/[0.03] focus:bg-white focus-visible:ring-2 focus-visible:ring-ios-accent/[0.12]" />
            </div>
          </div>

          {error && <p role="alert" className="rounded-xl bg-white px-4 py-3 text-[14px] text-ios-red">{error}</p>}

          <Group footer={draft.active ? 'Anyone in the firm can chat with it.' : 'A draft. Switch it on and save to start chatting with it.'}>
            <SwitchRow label="Available in Chat" on={draft.active} onChange={() => set({ active: !draft.active })} />
          </Group>

          <Group title="Model" footer={BOT_MODELS[draft.model].hint + '.'}>
            <div className="p-3">
              <Segmented label="Model" value={draft.model} onChange={v => set({ model: v as BotModel })}
                options={(Object.keys(BOT_MODELS) as BotModel[]).map(k => ({ value: k, label: BOT_MODELS[k].label }))} />
            </div>
          </Group>

          <Group title="Can look at" footer="What it can read in the portal. Asked about anything else, it says it can’t see it.">
            {Object.entries(BOT_TOOLS).map(([k, t]) => (
              <SwitchRow key={k} label={t.label} hint={t.hint} on={draft.tools.includes(k as never)} onChange={() => set({ tools: flip(draft.tools, k as never) })} />
            ))}
          </Group>

          <Group title="Can do in the portal" footer="Every change waits for your approval in the chat before it happens.">
            {Object.entries(BOT_ACTIONS).map(([k, t]) => (
              <SwitchRow key={k} label={t.label} hint={t.hint} on={draft.actions.includes(k as never)} onChange={() => set({ actions: flip(draft.actions, k as never) })} />
            ))}
          </Group>

          <Group title="Outside the portal" footer="The general assistant in Chat stays inside the portal. Use an agent for anything online.">
            {Object.entries(EXTERNAL_TOOLS).map(([k, t]) => (
              <SwitchRow key={k} label={t.label} hint={t.hint} on={draft.external.includes(k as never)} onChange={() => set({ external: flip(draft.external, k as never) })} />
            ))}
          </Group>

          <Group title="Instructions" footer="Followed in every chat: its job, its tone and what it must never do.">
            <textarea aria-label="Instructions" rows={7} value={draft.instructions} onChange={e => set({ instructions: e.target.value })}
              placeholder="e.g. You help the intake team. Draft a warm first reply, suggest the next step, and never give legal advice."
              className="block w-full resize-y bg-white px-4 py-3 text-[15px] leading-[22px] text-ios-label outline-none placeholder:text-ios-tertiary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ios-accent/[0.12]" />
          </Group>

          <Group title="Schedule" footer={sched.enabled
            ? `${scheduleLabel(sched)}, ${sched.tz.replace(/_/g, ' ')} time. It follows its instructions, using only what it can look at, and emails the result.${live ? '' : ' Schedules run in the live portal only.'}`
            : 'Run it by itself, like a daily lead update, and email the result to your team.'}>
            <SwitchRow label="Run automatically" on={sched.enabled} onChange={() => setSchedule({ enabled: !sched.enabled })} />
            {sched.enabled && (
              <>
                <div className="grid gap-2 px-4 py-3">
                  <span className="text-[13px] text-ios-secondary">Days</span>
                  <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
                    {DAYS.map((d, i) => {
                      const on = sched.days.includes(i)
                      return <button key={d} type="button" aria-pressed={on} onClick={() => setSchedule({ days: on ? sched.days.filter(x => x !== i) : [...sched.days, i].sort() })}
                        className={cn('h-8 min-w-[44px] rounded-full px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ios-accent/50',
                          on ? 'bg-ios-accent text-white' : 'bg-ios-field text-ios-secondary hover:text-ios-label')}>{d}</button>
                    })}
                  </div>
                </div>
                <label className="flex min-h-11 items-center gap-3 py-2 pr-3 pl-4">
                  <span className="flex-1 text-[15px] text-ios-label">Time</span>
                  <input type="time" value={sched.time} onChange={e => setSchedule({ time: e.target.value || '08:00' })}
                    className="rounded-lg bg-ios-field px-2 py-1 text-[15px] text-ios-label outline-none focus-visible:ring-2 focus-visible:ring-ios-accent/50" />
                </label>
              </>
            )}
          </Group>

          {sched.enabled && (
            <Group title="Email the result to" footer={team.length ? 'Only people in your firm can be chosen. Emails come from your firm’s own address.' : 'Nobody in the team yet.'}>
              {team.map(m => (
                <SwitchRow key={m.name} label={m.name} hint={m.role} on={sched.to.includes(m.name)}
                  onChange={() => setSchedule({ to: sched.to.includes(m.name) ? sched.to.filter(x => x !== m.name) : [...sched.to, m.name] })} />
              ))}
            </Group>
          )}

          <Group title="Runs" footer={dirty ? 'Save your changes first, then run it to see the result.' : bot.lastRunAt ? `Last ran ${when(bot.lastRunAt)}.` : 'It hasn’t run on its own yet.'}>
            <button type="button" disabled={dirty || running || !draft.instructions.trim()} onClick={runNow}
              className="flex min-h-11 w-full items-center justify-center text-[15px] font-medium text-ios-accent outline-none hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ios-accent/40 disabled:opacity-40">
              {running ? 'Running… this takes a few seconds' : sched.to.length ? 'Run now and email it' : 'Run now'}
            </button>
            {runs.slice(0, 5).map(r => (
              <details key={r.id} className="group px-4 py-2.5">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] text-ios-label outline-none [&::-webkit-details-marker]:hidden">
                  <span className={cn('size-2 shrink-0 rounded-full', r.status === 'done' ? 'bg-ios-green' : 'bg-ios-red')} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{when(r.at)} · {r.trigger === 'schedule' ? 'Scheduled' : 'Run now'}</span>
                  <span className="shrink-0 text-[12.5px] text-ios-secondary">{r.status === 'failed' ? 'Failed' : EMAIL_NOTE[r.emailStatus]}{r.emailStatus === 'sent' ? ` to ${r.recipients.length}` : ''}</span>
                </summary>
                {r.error && <p className="mt-2 text-[13px] text-ios-red">{r.error}</p>}
                {r.output && <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ios-field p-3 text-[13px] leading-[19px] text-ios-label">{r.output}</p>}
              </details>
            ))}
          </Group>

          <Group footer={`${bot.runs} ${bot.runs === 1 ? 'run' : 'runs'} · Updated ${when(bot.updatedAt)} by ${bot.updatedBy}`}>
            {confirming ? (
              <div className="grid gap-3 px-4 py-3">
                <p className="text-[14px] leading-5 text-ios-label">Delete “{bot.name}”? Its chats keep their history and move to the assistant. This can’t be undone.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" autoFocus onClick={() => setConfirming(false)} className="h-8 rounded-full bg-ios-field px-4 text-[14px] font-medium text-ios-label outline-none focus-visible:ring-2 focus-visible:ring-ios-accent/50">Cancel</button>
                  <button type="button" onClick={remove} className="h-8 rounded-full bg-ios-red px-4 text-[14px] font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ios-red/50 focus-visible:ring-offset-2">Delete agent</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="flex min-h-11 w-full items-center justify-center gap-1.5 text-[15px] text-ios-red outline-none hover:bg-black/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ios-red/40">
                <IconTrash className="size-4" stroke={1.9} aria-hidden="true" />Delete agent
              </button>
            )}
          </Group>
        </div>
      </div>
    </aside>
  )
}
