// A firm's email design, wrapped around every email it sends. The same file is used by the portal's Settings preview
// (src/shared/emailLayout.ts), so what the firm sees there is exactly what clients get. Keep the two copies identical.
// Built with tables and inline styles, which is what email programs (Outlook, Gmail, Apple Mail) reliably display.

export interface EmailBrand {
  firmName: string
  /** Public https link to the logo; without one, the firm's name is shown instead. */
  logoUrl?: string | null
  /** "#RRGGBB" */
  color?: string | null
  /** Plain text, added under the message. */
  signature?: string | null
  /** Plain text, small print at the bottom: usually the firm's address. */
  footer?: string | null
}

const DEFAULT_COLOR = '#0f2347'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Blank lines start a new paragraph; single line breaks stay. */
const paragraphs = (s: string, style: string) =>
  s.trim().split(/\n\s*\n/).filter(Boolean).map(p => `<p style="${style}">${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')

/**
 * The email as HTML (designed) and plain text (for email programs that prefer it).
 * `marketing`: campaigns and surveys get a line saying how to stop receiving them; with `unsubscribeUrl` it is a link.
 */
export function renderEmail(brand: EmailBrand, body: string, opts: { marketing?: boolean; unsubscribeUrl?: string } = {}): { html: string; text: string } {
  const color = brand.color && /^#[0-9a-f]{6}$/i.test(brand.color) ? brand.color : DEFAULT_COLOR
  const logo = brand.logoUrl && /^https:\/\//.test(brand.logoUrl) ? brand.logoUrl : ''
  const link = opts.unsubscribeUrl && /^https?:\/\//.test(opts.unsubscribeUrl) ? opts.unsubscribeUrl : ''
  const stop = !opts.marketing ? '' : link ? 'Don’t want these emails?' : 'To stop receiving these emails, reply with “unsubscribe”.'
  const p = 'margin:0 0 16px;font-size:15px;line-height:24px;color:#1f2937;'
  const small = 'margin:0 0 6px;font-size:12px;line-height:18px;color:#6b7280;'

  const header = logo
    ? `<img src="${esc(logo)}" alt="${esc(brand.firmName)}" height="44" style="display:block;height:44px;max-width:240px;width:auto;border:0;outline:none;">`
    : `<span style="font-size:18px;font-weight:700;color:${color};letter-spacing:-0.01em;">${esc(brand.firmName)}</span>`

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(brand.firmName)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
    <tr><td style="height:6px;line-height:6px;font-size:0;background:${color};">&nbsp;</td></tr>
    <tr><td style="padding:28px 32px 12px;">${header}</td></tr>
    <tr><td style="padding:12px 32px 4px;">${paragraphs(body, p)}</td></tr>
    ${brand.signature?.trim() ? `<tr><td style="padding:0 32px 12px;">${paragraphs(brand.signature, p.replace('#1f2937', '#374151'))}</td></tr>` : ''}
    <tr><td style="padding:0 32px 28px;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:Arial,Helvetica,sans-serif;">
    <tr><td align="center" style="padding:16px 32px 0;">
      ${brand.footer?.trim() ? paragraphs(brand.footer, small) : `<p style="${small}">${esc(brand.firmName)}</p>`}
      ${stop ? `<p style="${small}">${esc(stop)}${link ? ` <a href="${esc(link)}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>` : ''}</p>` : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`

  const text = [body.trim(), brand.signature?.trim(), '—', brand.footer?.trim() || brand.firmName, link ? `${stop} Unsubscribe: ${link}` : stop].filter(Boolean).join('\n\n')
  return { html, text }
}
