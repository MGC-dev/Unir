// Turns an agent's plain-text report into a simple A4 PDF: a title, the date, then the text with "# " headings in
// bold and long lines wrapped. Uses the PDF standard fonts, so characters they can’t draw are swapped for close ones or left out.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'npm:pdf-lib@1.17.1'

const A4 = [595.28, 841.89] as const
const MARGIN = 56
const SIZE = 11, LEAD = 16, HEAD = 13

/** Characters the standard fonts can't draw, swapped for ones they can. Anything else they lack is left out. */
function safe(s: string, font: PDFFont): string {
  const t = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[\u2022\u25CF\u25AA]/g, '-').replace(/\u00A0/g, ' ').replace(/\t/g, '  ')
  let out = ''
  for (const ch of t) { try { font.encodeText(ch); out += ch } catch { /* not in the font, e.g. emoji: left out */ } }
  return out
}

/** Splits one line into pieces that fit the page width. */
function wrap(line: string, font: PDFFont, size: number, width: number): string[] {
  const words = line.split(' '), lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (font.widthOfTextAtSize(next, size) <= width) { cur = next; continue }
    if (cur) lines.push(cur)
    cur = w
    while (font.widthOfTextAtSize(cur, size) > width && cur.length > 1) {
      let cut = cur.length - 1
      while (cut > 1 && font.widthOfTextAtSize(cur.slice(0, cut), size) > width) cut--
      lines.push(cur.slice(0, cut)); cur = cur.slice(cut)
    }
  }
  lines.push(cur)
  return lines
}

export async function reportPdf(title: string, subtitle: string, body: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(title)
  const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const width = A4[0] - MARGIN * 2
  let page = doc.addPage([...A4]), y = A4[1] - MARGIN

  const line = (text: string, font: PDFFont, size: number, color = rgb(0.1, 0.12, 0.16)) => {
    for (const piece of wrap(safe(text, font), font, size, width)) {
      if (y < MARGIN + size) { page = doc.addPage([...A4]); y = A4[1] - MARGIN }
      page.drawText(piece, { x: MARGIN, y: y - size, size, font, color })
      y -= size + (LEAD - SIZE)
    }
  }

  line(title, bold, 18); y -= 2
  line(subtitle, regular, 10, rgb(0.42, 0.45, 0.5)); y -= 12
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const text = raw.replace(/\*\*(.+?)\*\*/g, '$1').trimEnd()
    if (!text.trim()) { y -= LEAD / 2; continue }
    const h = text.match(/^#{1,6}\s+(.*)$/)
    if (h) { y -= 4; line(h[1], bold, HEAD); y -= 2 }
    else line(text.replace(/^(\s*)[*•]\s+/, '$1- '), regular, SIZE)
  }
  return await doc.save()
}

/** Base64 for an email attachment. */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
