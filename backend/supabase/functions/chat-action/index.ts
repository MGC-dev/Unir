// A person approves or declines the change an assistant or agent proposed in chat. Approved changes run in the
// database (run_agent_action), recorded in the audit log as the agent's, with the approving person.
// POST { message_id, decision: 'approve' | 'decline', firm_id? }
import { HttpError, admin, audit, body, caller, handle, json } from '../_shared/core.ts'

handle(async req => {
  const b = await body<{ message_id?: string; decision?: string; firm_id?: string }>(req)
  const me = await caller(req, b.firm_id)
  // Read as the caller: only their own conversations are visible.
  const { data: msg } = await me.db.from('chat_messages').select('id, firm_id, conversation_id, action, conversations(bot_id)').eq('id', b.message_id ?? '').single()
  if (!msg?.action) throw new HttpError(404, 'No change to approve')
  if (msg.action.status !== 'proposed') throw new HttpError(409, `This change was already ${msg.action.status}`)
  const botId = (msg.conversations as unknown as { bot_id: string | null } | null)?.bot_id ?? null
  const db = admin()

  let action = { ...msg.action }
  if (b.decision !== 'approve') action = { ...action, status: 'cancelled', result: `Declined by ${me.name}` }
  else if (action.kind === 'send_text') action = { ...action, status: 'failed', result: 'Texts can’t be sent until a texting provider is connected' }
  else {
    const { data, error } = await db.rpc('run_agent_action', { p_firm: msg.firm_id, p_user: me.user.id, p_bot: botId, p_kind: action.kind, p_params: action.params })
    action = error ? { ...action, status: 'failed', result: error.message } : { ...action, status: 'done', result: (data as { result?: string })?.result ?? 'Done' }
  }

  await db.from('chat_messages').update({ action }).eq('id', msg.id)
  await audit({ firmId: msg.firm_id, actorType: botId ? 'agent' : 'user', actorId: me.user.id, botId, action: `agent.action.${action.status}`, table: 'chat_messages', recordId: msg.id, meta: { kind: action.kind, params: action.params, result: action.result } })
  return json({ action })
})
