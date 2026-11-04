// Maakt HANDLEIDING.pdf uit HANDLEIDING.md (A4, huisstijl) via Chromium.
import { chromium } from 'playwright'
import { marked } from 'marked'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const md = readFileSync(`${root}HANDLEIDING.md`, 'utf8')
const body = marked.parse(md)

const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 10.5pt/1.55 'Segoe UI', system-ui, sans-serif; color: #1b1b1f; }
  h1 { font-size: 19pt; color: #ea5b0c; border-bottom: 3px solid #e2231a; padding-bottom: 4px; }
  h2 { font-size: 13pt; color: #c44a08; margin-top: 1.4em; border-left: 4px solid #ea5b0c; padding-left: 8px; }
  h3 { font-size: 11pt; margin-top: 1.1em; }
  table { border-collapse: collapse; width: 100%; margin: 0.6em 0; page-break-inside: avoid; }
  th, td { border: 1px solid #e6e6ea; padding: 5px 8px; text-align: left; vertical-align: top; font-size: 9.5pt; }
  th { background: #fff3ea; color: #c44a08; }
  code { background: #f3f3f5; border-radius: 3px; padding: 1px 4px; font-size: 9pt; }
  blockquote { border-left: 3px solid #f1dca7; background: #fff9ec; margin: 0.6em 0; padding: 6px 12px; color: #7a5708; }
  li { margin: 0.18em 0; }
  hr { border: none; border-top: 1px solid #e6e6ea; margin: 1.2em 0; }
  a { color: #c44a08; text-decoration: none; }
</style></head><body>${body}</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'networkidle' })
await page.pdf({
  path: `${root}HANDLEIDING.pdf`,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;text-align:center;font-size:8px;color:#999;">Service Procesgids — handleiding · pagina <span class="pageNumber"></span> van <span class="totalPages"></span></div>',
  margin: { top: '14mm', bottom: '14mm' },
})
await browser.close()
console.log('HANDLEIDING.pdf gemaakt')
