// Chat and Agents: answers a message with Claude, using the firm's own data. The general Chat only reads; agents can
// propose changes for a person to approve (approval is handled by chat-action), and learn their job from the chat:
// what the person tells them is saved as their instructions (update_instructions). With bot_id it answers as that agent: its instructions, model, and
// only the tools and actions switched on for it. Every message, the model used and its token counts are stored, and
// each exchange is written to the audit log.
// POST { message, conversation_id?, bot_id?, firm_id? }
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { HttpError, admin, audit, body, caller, env, handle, json } from '../_shared/core.ts'

const MODELS: Record<string, string> = {
  fast: Deno.env.get('MODEL_FAST') || 'claude-haiku-5-5',
  balanced: Deno.env.get('MODEL_BALANCED') || 'claude-sonnet-5-5',
  advanced: Deno.env.get('MODEL_ADVANCED') || 'claude-opus-5-5',
}
const ALL_TOOLS = ['leads', 'tasks', 'documents', 'campaigns', 'messages', 'services']
const STAGES = ['new', 'contacted', 'consult', 'contract', 'signed', 'payment', 'delivered', 'lost']
const TOOL_STEP: Record<string, string> = { leads: 'Read leads', tasks: 'Read tasks', documents: 'Read documents', campaigns: 'Read campaigns', messages: 'Read messages', services: 'Read services' }

/** What the assistant can propose. Nothing happens until a person approves it in the chat. */
const ACTION_TOOLS: Record<string, { description: string; input_schema: Record<string, unknown> }> = {
  create_lead: { description: 'Propose adding a new enquiry to the pipeline.', input_schema: { type: 'object', required: ['name'], properties: {
    name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, matter: { type: 'string' }, practice: { type: 'string' }, notes: { type: 'string' } } } },
  move_stage: { description: 'Propose moving a lead to another pipeline stage.', input_schema: { type: 'object', required: ['lead_name', 'stage'], properties: {
    lead_name: { type: 'string' }, stage: { type: 'string', enum: STAGES }, reason: { type: 'string', description: 'Why it was lost, when stage is lost' } } } },
  book_task: { description: 'Propose booking a call, meeting, follow-up, task or deadline.', input_schema: { type: 'object', required: ['title', 'due_at'], properties: {
    title: { type: 'string' }, type: { type: 'string', enum: ['task', 'call', 'meeting', 'follow_up', 'deadline'] }, due_at: { type: 'string', description: 'ISO 8601 date and time' },
    lead_name: { type: 'string' }, notes: { type: 'string' } } } },
  send_text: { description: 'Propose texting a lead.', input_schema: { type: 'object', required: ['lead_name', 'body'], properties: { lead_name: { type: 'string' }, body: { type: 'string' } } } },
  set_services: { description: 'Propose setting the services a lead takes, by service id.', input_schema: { type: 'object', required: ['lead_name', 'service_ids'], properties: {
    lead_name: { type: 'string' }, service_ids: { type: 'array', items: { type: 'string' } } } } },
}

/** Agents learn their job in their chat: this saves what they were told as their standing instructions, straight away. */
const LEARN_TOOL = {
  name: 'update_instructions',
  description: 'Save your standing instructions. Call it when the person tells you what your job is, how to behave, or asks you to change that ("from now on…"). Not for one-off requests.',
  input_schema: { type: 'object', required: ['instructions', 'description'], properties: {
    instructions: { type: 'string', description: 'Your complete new instructions, written to yourself: keep what still applies from the old ones and add or change what you were just told.' },
    description: { type: 'string', description: 'One short sentence saying what you are for, shown in the agents list.' },
  } },
}

/** A compact snapshot of the firm's data for the tools this assistant may read (read as the person, so RLS applies). */
async function snapshot(db: SupabaseClient, firmId: string, tools: string[]) {
  const parts: string[] = []
  const add = (title: string, rows: unknown[] | null) => parts.push(`## ${title}\n${JSON.stringify(rows ?? [])}`)
  if (tools.includes('leads')) add('Leads (newest 60)', (await db.from('leads').select('id, name, stage, matter, practice, source, value, lost_reason, created_at').eq('firm_id', firmId).order('created_at', { ascending: false }).limit(60)).data)
  if (tools.includes('tasks')) add('Open tasks (next 40)', (await db.from('tasks').select('title, type, due_at, lead_id').eq('firm_id', firmId).eq('done', false).order('due_at').limit(40)).data)
  if (tools.includes('documents')) add('Document library', (await db.from('documents').select('name, category, active, description').eq('firm_id', firmId).limit(50)).data)
  if (tools.includes('campaigns')) add('Campaigns', (await db.from('campaigns').select('name, kind, channel, active, draft, sent_at, trigger, audience').eq('firm_id', firmId).limit(50)).data)
  if (tools.includes('messages')) add('Recent messages (20)', (await db.from('messages').select('channel, direction, status, subject, body, created_at, lead_id').eq('firm_id', firmId).order('created_at', { ascending: false }).limit(20)).data)
  if (tools.includes('services')) add('Services', (await db.from('services').select('id, name, practice, pricing_model, price, retainer, active').eq('firm_id', firmId).limit(80)).data)
  return parts.join('\n\n')
}

handle(async req => {
  const b = await body<{ message?: string; conversation_id?: string; bot_id?: string; firm_id?: string }>(req)
  const me = await caller(req, b.firm_id)
  const text = (b.message ?? '').trim()
  if (!text) throw new HttpError(400, 'Type a message')
  if (text.length > 8000) throw new HttpError(413, 'That message is too long')
  const db = admin()

  // Chat and agents are add-ons: when REQUIRE_ADDONS is on, the firm must have them.
  const { data: firm } = await me.db.from('firms').select('name, addons').eq('id', me.firmId).single()
  const needs = b.bot_id ? 'agents' : 'chat'
  if (Deno.env.get('REQUIRE_ADDONS') === 'true' && !(firm?.addons ?? []).includes(needs)) throw new HttpError(402, `${needs === 'chat' ? 'Chat' : 'Agents'} isn’t part of your firm’s plan yet`)

  // The conversation (new, or one of the caller's own).
  let conv: { id: string; bot_id: string | null; title: string } | null = null
  if (b.conversation_id) {
    conv = (await me.db.from('conversations').select('id, bot_id, title').eq('id', b.conversation_id).single()).data
    if (!conv) throw new HttpError(404, 'Conversation not found')
  } else {
    const { data, error } = await me.db.from('conversations').insert({ firm_id: me.firmId, user_id: me.user.id, bot_id: b.bot_id ?? null, title: text.slice(0, 60) }).select('id, bot_id, title').single()
    if (error) throw new HttpError(400, error.message)
    conv = data
  }

  const bot = conv!.bot_id ? (await me.db.from('bots').select('*').eq('id', conv!.bot_id).single()).data : null
  if (conv!.bot_id && (!bot || !bot.active)) throw new HttpError(409, 'This agent is switched off')
  const tools: string[] = bot ? bot.tools : ALL_TOOLS
  // The general Chat is read-only: only agents with actions switched on can propose changes.
  const actions: string[] = bot ? bot.actions : []
  const model = MODELS[bot?.model ?? 'balanced']

  const { data: history } = await me.db.from('chat_messages').select('role, text').eq('conversation_id', conv!.id).order('created_at', { ascending: false }).limit(20)
  // Claude needs the conversation to start with the person and alternate, so drop a leading assistant turn.
  const past = (history ?? []).reverse().map(m => ({ role: m.role as 'user' | 'assistant', content: m.text || '…' }))
  while (past.length && past[0].role !== 'user') past.shift()
  const system = [
    `You are ${bot ? bot.name + ', an agent' : 'the assistant'} inside the lead portal of ${firm?.name}, a law firm. You are talking with ${me.name}. Today is ${new Date().toISOString().slice(0, 10)}.`,
    bot?.instructions ? `Your instructions from the firm:\n${bot.instructions}` : '',
    bot && !bot.instructions?.trim() ? 'You have no instructions yet. Unless the person is already telling you your job, briefly ask what they want you to do. When they tell you, call update_instructions.' : '',
    bot ? 'If the person tells you how to work from now on, call update_instructions so you remember it.' : '',
    'Answer only from the firm data below; say so when it does not contain the answer. Never give legal advice. Keep answers short.',
    actions.length ? 'To change something, call one of your tools. The change is shown to the person and only happens if they approve it, so propose at most one change per reply and say what you proposed.' : 'You can read but not change anything. If asked to change something, say that Chat is read-only and the person can do it from the page itself or ask an agent.',
    `# Firm data\n${await snapshot(me.db, me.firmId, tools)}`,
  ].filter(Boolean).join('\n\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 1024, system,
      messages: [...past, { role: 'user', content: text }],
      tools: [...actions.filter(a => ACTION_TOOLS[a]).map(a => ({ name: a, ...ACTION_TOOLS[a] })), ...(bot ? [LEARN_TOOL] : [])],
    }),
  })
  const out = await res.json()
  if (!res.ok) throw new HttpError(502, `Claude: ${out?.error?.message ?? res.statusText}`)

  const blocks = (out.content ?? []) as { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]
  const call = blocks.find(x => x.type === 'tool_use' && x.name && actions.includes(x.name))
  let answer = blocks.filter(x => x.type === 'text').map(x => x.text).join('\n').trim()

  // The agent was told its job: save it as its instructions now (it is the person's own instruction, so no approval).
  const learn = bot ? blocks.find(x => x.type === 'tool_use' && x.name === 'update_instructions') : undefined
  const learned = !!(learn && String(learn.input?.instructions ?? '').trim())
  if (learned) {
    const first = !bot.instructions?.trim()
    await db.from('bots').update({
      instructions: String(learn!.input!.instructions).trim().slice(0, 8000),
      description: String(learn!.input!.description ?? '').trim().slice(0, 300) || bot.description,
      updated_by: me.user.id,
    }).eq('id', bot.id).eq('firm_id', me.firmId)
    if (!answer) answer = first ? 'Got it. That’s my job now, and I’ll follow it in every chat. Tell me “from now on…” any time to change it.' : 'Noted. I’ve updated my instructions.'
  }
  const action = call ? {
    kind: call.name, status: 'proposed',
    params: Object.fromEntries(Object.entries(call.input ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v : String(v)])),
    summary: `${call.name!.replace('_', ' ')}: ${Object.values(call.input ?? {}).filter(v => typeof v === 'string').join(' · ')}`.slice(0, 200),
  } : null

  const steps = tools.map(t => TOOL_STEP[t])
  await db.from('chat_messages').insert({ firm_id: me.firmId, conversation_id: conv!.id, role: 'user', text })
  const { data: reply } = await db.from('chat_messages').insert({
    firm_id: me.firmId, conversation_id: conv!.id, role: 'assistant', text: answer || (action ? 'Here is the change I suggest.' : '…'), steps, action,
    model: out.model ?? model, input_tokens: out.usage?.input_tokens ?? null, output_tokens: out.usage?.output_tokens ?? null,
  }).select('*').single()
  await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conv!.id)
  if (bot) await db.rpc('bump_bot_runs', { p_bot: bot.id })
  await audit({ firmId: me.firmId, actorType: bot ? 'agent' : 'user', actorId: me.user.id, botId: bot?.id, action: 'chat.message', table: 'chat_messages', recordId: reply?.id,
    meta: { conversation_id: conv!.id, model: out.model ?? model, input_tokens: out.usage?.input_tokens, output_tokens: out.usage?.output_tokens, proposed: action?.kind ?? null, instructions_updated: learned } })

  return json({ conversation_id: conv!.id, message: reply, instructions_updated: learned })
})
