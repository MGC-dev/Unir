# MGC Lead Portal — backend

Supabase is the whole backend: Postgres for the data, Supabase Auth for sign-in, Storage for document files,
and Edge Functions for the work that can't happen in the browser (sending email, calling Claude, inviting people,
webhooks). Everything here is checked in, so the database can be rebuilt from scratch at any time.

```
backend/supabase/
  config.toml                   CLI settings (invite-only auth, webhook without JWT)
  migrations/                   the database, in order
    …_firms_and_members.sql     firms, members, is_member()/is_admin(), onboard_firm()
    …_crm.sql                   leads, activities, tasks, services, documents, campaigns, folders, templates, messages, integrations, storage bucket
    …_agents_chat_audit.sql     agents, conversations, chat messages, append-only audit_log + triggers
    …_agent_actions.sql         run_agent_action(): approved agent changes, recorded as the agent's
  functions/
    invite-member/              a firm admin invites a teammate
    send-email/                 email one lead through Resend
    send-campaign/              send a one-off campaign or survey (Resend batches of 100)
    resend-webhook/             delivery, open, bounce and spam events from Resend
    chat/                       Chat and Agents with Claude, using the firm's data
    chat-action/                approve or decline a change the assistant proposed
    _shared/                    auth, CORS, audit, input filling, Resend client
```

## How firms are kept apart

One database serves every client firm. Each table has `firm_id`, and **row level security** only lets a signed-in
person read or change rows of a firm they belong to (`firm_members`). Triggers also stop a row from pointing at
another firm's lead, campaign, folder or service, and stop a lead or task being given to someone outside the firm.
Document files live in the private `documents` bucket under `<firm_id>/…` with the same rule.

This was tested on Postgres 16 with two firms. One firm can't read or write the other's data, including files.
Only admins read the audit log, nobody can edit or delete it, and only MGC can onboard a firm.

## Audit log

`audit_log` records every insert, update and delete on the firm's tables (with the row before and after), plus named
events from the functions: `chat.message` (model and tokens), `agent.action.done|failed|cancelled`, `email.sent|held`,
`campaign.sent`, `member.invited`. `actor_type` says whether a person, an agent (with `bot_id` and the approving
person) or the system did it. Firm admins can read their firm's log; nobody can change it.

## Set up a project

1. Install the CLI: `brew install supabase/tap/supabase`, then `supabase login`.
2. From this folder: `supabase link --project-ref <your project ref>` (Project Settings → General).
3. Apply the database: `supabase db push`.
4. Secrets: copy `supabase/functions/.env.example` to `supabase/functions/.env`, fill it in, then
   `supabase secrets set --env-file supabase/functions/.env`.
5. Deploy the functions: `supabase functions deploy` (`resend-webhook` deploys without JWT checks, per `config.toml`).
6. In the dashboard, Authentication:
   - turn off "Allow new users to sign up";
   - URL Configuration: set the Site URL (the portal's address) and add `http://localhost:5173/**` as a redirect URL;
   - Email Templates: in **Invite user**, make the link
     `{{ .SiteURL }}/sign-in?set-password&token_hash={{ .TokenHash }}&type=invite`, and in **Reset password**
     the same with `type=recovery`. People then land on the portal's "Choose a password" page.
7. In Resend: verify each firm's sending domain, and add a webhook to
   `https://<project ref>.supabase.co/functions/v1/resend-webhook` for delivered, opened, bounced and complained events.

## Onboard a firm (MGC)

1. Authentication → Users → **Invite user** with the firm's first admin's email.
2. SQL editor:
   ```sql
   select public.onboard_firm('Example Family Law LLP', 'sarah@examplelaw.com', 'Sarah Mitchell');
   ```
3. Set the firm's domain once Resend has verified it:
   `update firms set domain = 'examplelaw.com', domain_status = 'verified' where name = 'Example Family Law LLP';`

From then on the firm's admin invites their own team from the portal (the `invite-member` function).

## Calling the functions from the portal

```ts
const { data, error } = await supabase.functions.invoke('send-email', { body: { lead_id, subject, body } })
const { data } = await supabase.functions.invoke('chat', { body: { message, conversation_id, bot_id } })
```
Supabase adds the signed-in person's token, and each function checks it and their firm.

## Not done yet

- **Texts:** no texting provider yet (RingCentral or Twilio). Texts are recorded as *held* with the reason.
- **Automatic campaigns** ("when a ticket moves to Signed") need a trigger or a database webhook that calls a sender.
- **E-signature and payments:** `engagement_packets.provider_ref` is ready for the signature provider; Stripe will be a webhook function.
- **Very large sends:** `send-campaign` handles up to 2,000 people per request; bigger audiences need a queue.
- **The portal still uses its mock data** (`src/api/index.ts`). Next step: replace each function there with a Supabase query or function call; the shapes stay the same.
