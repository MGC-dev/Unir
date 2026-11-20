import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconBrandGoogle, IconCheck, IconExternalLink, IconRefresh } from '@tabler/icons-react'
import { tasksApi, eventsApi, leadsApi, googleCalendarApi, useQuery, type GoogleCalendarEvent } from '../../api'
import { config } from '../../api/mockData'
import type { TaskType } from '../../api/types'
import { useUi } from '../../app/UiContext'
import { TASK_TYPES } from '../tasks/TaskSheet'
import { calEvents } from './calendarEvents'
import { EventManager, type CalendarView, type Event, type EventColor } from '@/components/ui/event-manager'
import { Button } from '@/components/ui/button'

const FIRM = 'Firm event'
const GOOGLE = 'Google Calendar'
/** How far around today Google events are fetched. */
const GOOGLE_BACK_DAYS = 60, GOOGLE_AHEAD_DAYS = 180
/** One solid colour per kind of task (the same as Tasks), written out in full so Tailwind generates them. */
const COLORS: EventColor[] = [
  { name: 'Call', value: 'call', bg: 'bg-[#1f4fd8]', text: 'text-[#1f4fd8]' },
  { name: 'Meeting', value: 'meeting', bg: 'bg-[#6d28d9]', text: 'text-[#6d28d9]' },
  { name: 'Follow-up', value: 'follow_up', bg: 'bg-[#0f766e]', text: 'text-[#0f766e]' },
  { name: 'Deadline', value: 'deadline', bg: 'bg-[#b91c1c]', text: 'text-[#b91c1c]' },
  { name: 'Task', value: 'task', bg: 'bg-[#475569]', text: 'text-[#475569]' },
  { name: FIRM, value: 'firm', bg: 'bg-[#8f6e2c]', text: 'text-[#8f6e2c]' },
  { name: GOOGLE, value: 'google', bg: 'bg-[#0b8043]', text: 'text-[#0b8043]' },
]
/** A Google event as a read-only calendar block. All-day events run from midnight to the end of their last day. */
function fromGoogle(g: GoogleCalendarEvent): Event {
  const start = g.allDay ? new Date(`${g.start}T00:00:00`) : new Date(g.start)
  const end = g.allDay ? new Date(+new Date(`${g.end}T00:00:00`) - 60_000) : new Date(g.end)
  return {
    id: `google:${g.id}`, title: g.title, description: [g.location, g.description].filter(Boolean).join('\n'),
    startTime: start, endTime: end, color: 'google', category: GOOGLE, tags: [], readOnly: true,
  }
}

/** The signed-in person's Google Calendar, fetched once when Calendar opens (and on Refresh). */
function useGoogleCalendar() {
  const [state, setState] = useState<{ connected: boolean; email?: string; events: GoogleCalendarEvent[]; loading: boolean; error?: string }>({ connected: false, events: [], loading: googleCalendarApi.available() })
  const load = useCallback(async () => {
    if (!googleCalendarApi.available()) return
    setState(s => ({ ...s, loading: true, error: undefined }))
    const now = Date.now()
    try {
      const r = await googleCalendarApi.events(new Date(now - GOOGLE_BACK_DAYS * 864e5), new Date(now + GOOGLE_AHEAD_DAYS * 864e5))
      setState({ connected: r.connected, email: r.email, events: r.events ?? [], loading: false, error: 'reconnect' in r && r.reconnect ? 'Google access was removed. Connect again to see your events.' : undefined })
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Couldn’t load your Google Calendar' }))
    }
  }, [])
  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}

const typeOfLabel = (label?: string) => (Object.entries(TASK_TYPES).find(([, v]) => v === label)?.[0] ?? 'task') as TaskType

/** Calls, meetings, follow-ups and deadlines from Tasks, with the firm's own events, by month, week, day or as a list. */
export default function Calendar() {
  const tasks = useQuery(() => tasksApi.list())
  const leads = useQuery(() => leadsApi.list())
  const firm = useQuery(() => eventsApi.list())
  const { filter, setFilter, openLead } = useUi()
  const google = useGoogleCalendar()

  const events = useMemo<Event[]>(() => {
    if (!tasks || !leads || !firm) return []
    return calEvents(tasks, leads, firm).map((x, i): Event => {
      const task = x.taskId ? tasks.find(t => t.id === x.taskId) : undefined
      return {
        id: x.taskId ?? `firm:${i}:${x.t}`,
        title: x.title,
        description: task ? task.notes : x.who,
        startTime: new Date(x.t),
        endTime: new Date(x.t + x.dur * 60_000),
        color: x.type ?? 'firm',
        category: x.type ? TASK_TYPES[x.type] : FIRM,
        tags: x.owner ? [x.owner] : [],
        readOnly: !x.taskId,
        done: x.done,
      }
    }).concat(google.events.map(fromGoogle))
  }, [tasks, leads, firm, google.events])

  if (!tasks || !leads || !firm) return null

  return (
    <div className="ai-surface apple-type calx calx--em">
      {googleCalendarApi.available() && (
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[13px] text-muted-foreground" role="status">
          <IconBrandGoogle className="size-4 shrink-0 text-[#0b8043]" aria-hidden="true" />
          {google.loading ? <span>Loading your Google Calendar…</span>
            : google.connected ? <span>Showing Google Calendar for <b className="font-medium text-foreground">{google.email}</b> (read-only)</span>
              : <span>{google.error ?? 'See your Google Calendar events here, next to the portal’s.'}</span>}
          {!google.loading && google.connected && (
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={google.reload}><IconRefresh className="size-3.5" />Refresh</Button>
          )}
          {!google.loading && !google.connected && (
            <Button variant="outline" size="sm" className="h-7 px-2.5" onClick={() => googleCalendarApi.connect()}>Connect Google Calendar</Button>
          )}
          {google.connected && google.error && <span className="text-destructive">{google.error}</span>}
        </div>
      )}
      <EventManager
        className="h-full"
        events={events}
        defaultView={(filter.calmode as CalendarView) ?? 'week'}
        onViewChange={v => setFilter('calmode', v)}
        categories={(['call', 'meeting', 'follow_up', 'deadline', 'task'] as TaskType[]).map(k => TASK_TYPES[k])}
        colors={COLORS}
        colorFromCategory={c => COLORS.find(x => x.name === c)?.value}
        availableTags={config.owners}
        singleTag
        labels={{ newEvent: 'Schedule', category: 'Type', tags: 'Assigned to' }}
        onEventCreate={e => tasksApi.create({
          type: typeOfLabel(e.category), title: e.title, dueAt: +e.startTime,
          assignedTo: e.tags?.[0] ?? config.owners[0], notes: e.description || undefined,
        })}
        onEventUpdate={(id, e) => {
          if (id.startsWith('firm:') || id.startsWith('google:')) return
          tasksApi.update(id, {
            ...(e.title !== undefined && { title: e.title }),
            ...(e.startTime && { dueAt: +e.startTime }),
            ...(e.category && { type: typeOfLabel(e.category) }),
            ...(e.tags?.[0] && { assignedTo: e.tags[0] }),
            ...(e.description !== undefined && { notes: e.description || undefined }),
          })
        }}
        onEventDelete={id => { if (!id.startsWith('firm:') && !id.startsWith('google:')) tasksApi.remove(id) }}
        dialogActions={(e, close) => {
          const g = e.id.startsWith('google:') ? google.events.find(x => `google:${x.id}` === e.id) : undefined
          if (g?.link) return (
            <Button asChild variant="outline" size="sm" className="gap-1.5" onClick={close}>
              <a href={g.link} target="_blank" rel="noreferrer"><IconExternalLink className="h-4 w-4" />Open in Google Calendar</a>
            </Button>
          )
          const t = tasks.find(x => x.id === e.id)
          if (!t) return null
          const lead = t.leadId ? leads.find(l => l.id === t.leadId) : undefined
          return (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => { await tasksApi.toggle(t.id); close() }}>
                <IconCheck className="h-4 w-4" />{t.done ? 'Not done' : 'Done'}
              </Button>
              {lead && (
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { close(); openLead(lead.id) }}>
                  <IconExternalLink className="h-4 w-4" />{lead.name.split(' ')[0]}’s ticket
                </Button>
              )}
            </>
          )
        }}
      />
    </div>
  )
}
