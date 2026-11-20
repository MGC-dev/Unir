// Runs an agent on its own: the agent reads the firm's data (only the parts switched on for it), follows its
// instructions, and its answer is emailed to the team members chosen in its Schedule settings. Every run is saved in
// bot_runs and the audit log.
//
// Two callers:
//   - the pg_cron job, every 15 minutes:  POST { scheduled: true } with the x-runner-secret header → runs every agent that is due
//   - "Run now" in the portal:            POST { bot_id } with the signed-in person's token → runs that agent once
// Deploy with verify_jwt = false: this function checks the secret or the person itself.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { HttpError, admin, audit, caller, env, json } from '../_shared/core.ts'
import { type FirmRow, brandOf, emailBlocked, fromAddress, renderEmail, sendEmail } from '../_shared/messaging.ts'
import { reportPdf, toBase64 } from '../_shared/pdf.ts'

const MODELS: Record<string, string> = {
  fast: Deno.env.get('MODEL_FAST') || 'claude-haiku-5-5',
  balanced: Deno.env.get('MODEL_BALANCED') || 'claude-sonnet-5-5',
  advanced: Deno.env.get('MODEL_ADVANCED') || 'claude-opus-5-5',
}

interface BotRow {
  id: string; firm_id: string; name: string; instructions: string; model: string; tools: string[]; active: boolean
  schedule_tz: string; deliver_to: string[]; deliver_pdf?: boolean; runs: number
}

/** A compact snapshot of the firm's data, limited to what the agent may read. */
async function snapshot(db: SupabaseClient, firmId: string, tools: string[]) {
  const parts: string[] = []
  const add = (title: string, rows: unknown[] | null) => parts.push(`## ${title}\n${JSON.stringify(rows ?? [])}`)
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  if (tools.includes('leads')) {
    add('Leads (newest 80)', (await db.from('leads').select('id, name, stage, matter, practice, source, value, lost_reason, created_at, updated_at').eq('firm_id', firmId).order('created_at', { ascending: false }).limit(80)).data)
    add('Lead activity, last 7 days', (await db.from('lead_activities').select('lead_id, at, type, title').eq('firm_id', firmId).gte('at', since).order('at', { ascending: false }).limit(150)).data)
  }
  if (tools.includes('tasks')) add('Open tasks (next 60)', (await db.from('tasks').select('title, type, due_at, lead_id').eq('firm_id', firmId).eq('done', false).order('due_at').limit(60)).data)
  if (tools.includes('documents')) add('Documents sent for signature', (await db.from('engagement_packets').select('lead_id, status, sent_at, signed_at').eq('firm_id', firmId).order('sent_at', { ascending: false }).limit(40)).data)
  if (tools.includes('campaigns')) add('Campaigns', (await db.from('campaigns').select('name, kind, channel, active, draft, sent_at, trigger, audience').eq('firm_id', firmId).limit(50)).data)
  if (tools.includes('messages')) add('Messages, last 7 days', (await db.from('messages').select('channel, direction, status, subject, created_at, lead_id').eq('firm_id', firmId).gte('created_at', since).order('created_at', { ascending: false }).limit(60)).data)
  if (tools.includes('services')) add('Services', (await db.from('services').select('name, practice, pricing_model, price, retainer, active').eq('firm_id', firmId).limit(80)).data)
  return parts.join('\n\n')
}

/** Runs one agent and records it. Never throws: a failed run is saved as failed. */
async function run(db: SupabaseClient, bot: BotRow, trigger: 'schedule' | 'manual', runBy: string | null) {
  const { data: firm } = await db.from('firms').select('*').eq('id', bot.firm_id).single<FirmRow>()
  const now = new Date()
  const today = now.toLocaleDateString('en-ZA', { timeZone: bot.schedule_tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  let output = '', status: 'done' | 'failed' = 'done', error: string | null = null, model = MODELS[bot.model] ?? MODELS.balanced
  let usage: { input_tokens?: number; output_tokens?: number } = {}

  try {
    const system = [
      `You are ${bot.name}, an agent for ${firm?.name}, a law firm. It is ${today}. You are running on your own, not in a chat: what you write is emailed to the firm's team as it is.`,
      bot.instructions ? `Your instructions from the firm:\n${bot.instructions}` : 'Summarise what needs the team\'s attention.',
      'Use only the firm data below, and say plainly when there is nothing to report. Never give legal advice. Write plain text with short headings and bullet points, ready to send; no greeting placeholders.',
      `# Firm data\n${await snapshot(db, bot.firm_id, bot.tools)}`,
    ].join('\n\n')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1500, system, messages: [{ role: 'user', content: `Write today's ${bot.name}.` }] }),
    })
    const out = await res.json()
    if (!res.ok) throw new Error(`Claude: ${out?.error?.message ?? res.statusText}`)
    output = (out.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n').trim()
    model = out.model ?? model
    usage = out.usage ?? {}
  } catch (e) {
    status = 'failed'; error = e instanceof Error ? e.message : 'The agent failed'
  }

  // Email it to the chosen members of this firm only.
  const recipients: string[] = []
  let emailStatus: 'none' | 'sent' | 'held' | 'failed' = 'none'
  if (status === 'done' && bot.deliver_to?.length) {
    const { data: members } = await db.from('firm_members').select('user_id').eq('firm_id', bot.firm_id).in('user_id', bot.deliver_to)
    for (const m of members ?? []) {
      const { data } = await db.auth.admin.getUserById(m.user_id)
      if (data.user?.email) recipients.push(data.user.email)
    }
    const blocked = firm ? emailBlocked(firm) : 'Firm not found'
    if (!recipients.length) emailStatus = 'none'
    else if (blocked) { emailStatus = 'held'; error = blocked }
    else {
      try {
        const designed = renderEmail(brandOf(firm!), output)
        // Attached as a PDF too, when the agent is set to. A PDF that fails doesn't stop the email.
        let attachments: { filename: string; content: string }[] | undefined
        if (bot.deliver_pdf) {
          try {
            const day = now.toLocaleDateString('en-CA', { timeZone: bot.schedule_tz })
            attachments = [{ filename: `${bot.name.replace(/[^\w -]+/g, '').trim() || 'Report'} ${day}.pdf`, content: toBase64(await reportPdf(bot.name, `${firm!.name} · ${today}`, output)) }]
          } catch (e) { console.error('pdf failed', e) }
        }
        await sendEmail({ from: fromAddress(firm!), to: recipients, subject: `${bot.name}, ${today}`, text: designed.text, html: designed.html, tags: [{ name: 'agent', value: bot.id }], attachments })
        emailStatus = 'sent'
      } catch (e) { emailStatus = 'failed'; error = e instanceof Error ? e.message : 'Email failed' }
    }
  }

  const { data: saved } = await db.from('bot_runs').insert({
    firm_id: bot.firm_id, bot_id: bot.id, trigger, run_by: runBy, status, output, recipients, email_status: emailStatus, error,
    model, input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null,
  }).select('*').single()
  await db.rpc('bump_bot_runs', { p_bot: bot.id })
  if (trigger === 'manual') await db.from('bots').update({ last_run_at: now.toISOString() }).eq('id', bot.id)
  await audit({ firmId: bot.firm_id, actorType: trigger === 'schedule' ? 'system' : 'agent', actorId: runBy ?? undefined, botId: bot.id, action: `agent.run.${status}`,
    table: 'bot_runs', recordId: saved?.id, meta: { trigger, email_status: emailStatus, recipients: recipients.length, model, error } })
  return saved
}

Deno.serve(async req => {
  const cors = { 'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  try {
    if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405)
    const b = await req.json().catch(() => ({})) as { scheduled?: boolean; bot_id?: string }
    const db = admin()

    // The cron job: run everything that is due.
    if (b.scheduled) {
      const secret = req.headers.get('x-runner-secret') ?? ''
      const { data: ok } = await db.rpc('check_runner_secret', { t: secret })
      if (!secret || !ok) return reply({ error: 'Not allowed' }, 401)
      const { data: due, error } = await db.rpc('claim_due_bots')
      if (error) throw new HttpError(500, error.message)
      const runs = []
      for (const bot of (due ?? []) as BotRow[]) runs.push(await run(db, bot, 'schedule', null))
      return reply({ ran: runs.length })
    }

    // "Run now" from the portal, by a member of the agent's firm.
    const me = await caller(req)
    const { data: bot } = await me.db.from('bots').select('*').eq('id', b.bot_id ?? '').eq('firm_id', me.firmId).single<BotRow>()
    if (!bot) throw new HttpError(404, 'Agent not found')
    const saved = await run(db, bot, 'manual', me.user.id)
    return reply({ run: saved })
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status >= 500) console.error(e)
    return reply({ error: e instanceof Error ? e.message : 'Something went wrong' }, status)
  }
})
