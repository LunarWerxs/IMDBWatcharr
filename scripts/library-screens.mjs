// Screenshots of the signed-in library (/?demo) for a visual check: every interaction (the rail, the
// pin, copying, the bookmark, list rows, Share, New feed, Combine, rename, the confirm windows, the
// bell, the title popup, one feed, no feeds) at 375, 768 and 1280 wide, dark and light, and again
// under reduced motion. Headless, so nothing opens on the desktop.
//
//   npm run web:dev                                  # or any copy of the site
//   node scripts/library-screens.mjs http://localhost:5173 shots [1280-dark,375-light] [--only=onit,rail]
//
// Writes shots/<width>-<theme>[-rm]/NN-step.png and shots/report*.json (each step's result, console
// errors, failed requests). Needs playwright-core and its Chromium, which this repo does not install:
// `npx playwright install chromium`, then run with PLAYWRIGHT_CORE pointing at a playwright-core
// (a path or a package name). Playwright hides scrollbars by default; this keeps them, so the rows'
// scrollbar can be seen.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// A path (D:/..., ./..., /...) is a playwright-core folder; anything else is a package name.
const CORE = process.env.PLAYWRIGHT_CORE ?? 'playwright-core'
const { chromium } = await import(/^([a-z]:|[.]|[/])/i.test(CORE) ? pathToFileURL(resolve(CORE, 'index.mjs')).href : CORE)

const { values: flags, positionals } = parseArgs({ allowPositionals: true, options: { only: { type: 'string', default: '' } } })
const BASE = positionals[0] ?? 'http://localhost:5173'
const OUT = positionals[1] ?? './shots'
const FILTER = (positionals[2] ?? '').split(',').filter(Boolean)
const ONLY = flags.only.split(',').filter(Boolean)

const COMBOS = []
for (const width of [375, 768, 1280]) {
  for (const theme of ['dark', 'light']) COMBOS.push({ width, theme, rm: false })
}
for (const width of [375, 1280]) COMBOS.push({ width, theme: 'dark', rm: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* One QA step each: what to do, given the page and the helpers runCombo builds for it. */
const STEPS = [
  [
    'top',
    async ({ shot }) => {
      await shot('top')
      await shot('full', { fullPage: true })
    },
  ],
  [
    'onit',
    async ({ page, width, phone, shot, away, sectionClip }) => {
      await page.locator('#on-it-title').scrollIntoViewIfNeeded()
      await page.evaluate(() => document.getElementById('on-it-title').scrollIntoView({ block: 'center' }))
      await sleep(900)
      const clip = await sectionClip('section[aria-labelledby="on-it-title"]', 24)
      await shot('onit-rest', { clip })
      const row = page.locator('section[aria-labelledby="on-it-title"] ul').first()
      const metrics = await row.evaluate((ul) => ({ sw: ul.scrollWidth, cw: ul.clientWidth }))
      if (!phone) {
        const box = await row.boundingBox()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await sleep(400)
        await shot('onit-hover', { clip })
        const forward = page.locator('button[aria-label="Scroll the titles forward"]')
        await forward.click()
        await sleep(140)
        await shot('onit-moving', { clip })
        await sleep(1500)
        await shot('onit-after-arrow', { clip })
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.wheel(0, 0)
        await row.evaluate((ul) => ul.scrollBy({ left: 400 }))
        await sleep(80)
        await shot('onit-wheel-moving', { clip })
        await away()
        await sleep(1300)
        await shot('onit-after-leave', { clip })
        await row.evaluate((ul) => ul.scrollTo({ left: 0 }))
        await sleep(1200)
      } else {
        await row.evaluate((ul) => ul.scrollBy({ left: 300 }))
        await sleep(80)
        await shot('onit-swipe-moving', { clip })
        await sleep(1300)
        await shot('onit-swipe-after', { clip })
        await row.evaluate((ul) => ul.scrollTo({ left: 0 }))
        await sleep(1200)
      }
      return metrics
    },
  ],
  [
    'rail',
    async ({ page, phone, shot, away, railNav, pillsNav, feedButtons }) => {
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(500)
      if (phone) {
        await shot('pills')
        const pills = pillsNav().locator('button')
        await pills.nth(1).click()
        await sleep(900)
        await shot('pills-picked')
        await pills.nth(0).click()
        await sleep(900)
        return
      }
      await away()
      await sleep(400)
      await shot('rail-folded')
      await railNav().hover()
      await sleep(600)
      await shot('rail-open')
      await feedButtons().nth(1).click()
      await sleep(150)
      await away()
      await sleep(900)
      await shot('rail-after-click')
      await railNav().hover()
      await sleep(500)
      await railNav().locator('button[aria-pressed]').click()
      await away()
      await sleep(900)
      await shot('rail-pinned')
      await railNav().locator('button[aria-pressed]').click()
      await away()
      await sleep(900)
      await shot('rail-unpinned')
      await page.keyboard.press('Tab')
      await page.evaluate(() => (document.activeElement)?.blur())
      await page.locator('body').focus()
      await railNav().locator('ul button').first().focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await sleep(500)
      await shot('rail-keyboard')
      await page.evaluate(() => document.activeElement?.blur())
      await railNav().hover()
      await feedButtons().nth(0).click()
      await away()
      await sleep(900)
    },
  ],
  [
    'copy-setup',
    async ({ page, shot, pickFeed, sectionClip }) => {
      await pickFeed('Our house')
      await page.evaluate(() => window.scrollTo(0, 0))
      const copy = page.locator('button[aria-label="Copy the Radarr link"]:visible').first()
      await copy.click()
      await sleep(250)
      await shot('copied-flash')
      await sleep(900)
      await shot('copied-setup-open')
      await page.locator('#feed-setup').scrollIntoViewIfNeeded()
      await sleep(300)
      await shot('setup-steps', { clip: await sectionClip('#feed-setup', 60) })
      await page.getByRole('button', { name: 'Where do these go in Radarr and Sonarr?' }).click()
      await sleep(700)
    },
  ],
  [
    'bookmark',
    async ({ page, width, phone, shot }) => {
      if (phone) return 'no bookmark on a phone'
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(300)
      const sticker = page.locator('a.sticker:visible').first()
      await sticker.hover()
      await sleep(500)
      await shot('bookmark-hover')
      await sticker.click()
      await sleep(700)
      await shot('bookmark-clicked')
      const box = await sticker.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 20, box.y - 10, { steps: 4 })
      await page.mouse.move(box.x + 60, 30, { steps: 6 })
      await sleep(500)
      await shot('bookmark-dragging')
      await page.mouse.up()
      await sleep(600)
      await shot('bookmark-dropped')
      await sleep(8600)
      await shot('bookmark-hint-gone')
    },
  ],
  [
    'rows',
    async ({ page, shot, sectionClip, cancelAsk }) => {
      const rows = page.locator('section[aria-labelledby="lists-title"] ul > li button[aria-expanded]')
      await page.locator('#lists-title').scrollIntoViewIfNeeded()
      await rows.first().click()
      await sleep(700)
      await shot('row-open', { clip: await sectionClip('section[aria-labelledby="lists-title"]', 24) })
      await page.getByRole('button', { name: 'Take it out' }).first().click()
      await sleep(600)
      await shot('takeout-confirm')
      await cancelAsk()
      await rows.first().click()
      await sleep(600)
    },
  ],
  [
    'share',
    async ({ page, shot, cancelAsk }) => {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.getByRole('button', { name: /^Share/ }).first().click()
      await sleep(700)
      await shot('share-window')
      await page.getByRole('dialog').getByRole('button', { name: 'New link' }).click()
      await sleep(600)
      await shot('newlink-confirm')
      await cancelAsk()
      await page.keyboard.press('Escape')
      await sleep(600)
    },
  ],
  [
    'new-feed',
    async ({ page, phone, shot, railNav, pillsNav }) => {
      await page.evaluate(() => window.scrollTo(0, 0))
      if (phone) await pillsNav().getByRole('button', { name: 'New feed' }).click()
      else await railNav().getByRole('button', { name: 'New feed' }).click()
      await sleep(700)
      await shot('newfeed-window')
      const dialog = page.getByRole('dialog')
      await dialog.locator('p button').first().click()
      await sleep(700)
      await shot('newfeed-example')
      await dialog.getByRole('button', { name: 'Add another list' }).click()
      await sleep(700)
      await shot('newfeed-another')
      await dialog.locator('#new-feed-name').fill('Family night')
      await dialog.locator('input[type="url"]').nth(1).fill('not a link')
      await sleep(300)
      await shot('newfeed-named-invalid')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await sleep(700)
    },
  ],
  [
    'combine',
    async ({ page, shot, feedNames, pickFeed, openMenu, cancelAsk }) => {
      const names = await feedNames()
      const single = names.find((x) => /watchlist|Ghibli|Best Picture|greatest|Marvel/i.test(x) && !/house|night/i.test(x))
      await pickFeed(single ?? names[names.length - 1])
      await page.evaluate(() => window.scrollTo(0, 0))
      await shot('single-kind-feed')
      await page.getByRole('button', { name: 'Combine with another list' }).click()
      await sleep(700)
      await shot('combine-window')
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
      await sleep(600)
      await openMenu()
      await shot('menu-single')
      await page.getByRole('menuitem', { name: 'Stop following' }).click()
      await sleep(600)
      await shot('unfollow-confirm')
      await cancelAsk()
      return single
    },
  ],
  [
    'rename',
    async ({ page, shot, pickFeed, openMenu, cancelAsk }) => {
      await pickFeed('Our house')
      await page.evaluate(() => window.scrollTo(0, 0))
      await openMenu()
      await shot('menu-owner')
      await page.getByRole('menuitem', { name: 'Rename' }).click()
      await sleep(400)
      await shot('rename-field')
      await page.keyboard.press('End')
      await page.keyboard.type(' and friends with a long name')
      await sleep(200)
      await shot('rename-typing')
      await page.keyboard.press('Enter')
      await sleep(900)
      await shot('renamed')
      await openMenu()
      await page.getByRole('menuitem', { name: 'Delete feed' }).click()
      await sleep(600)
      await shot('delete-confirm')
      await cancelAsk()
    },
  ],
  [
    'leave',
    async ({ page, shot, pickFeed, openMenu, cancelAsk }) => {
      await pickFeed('Movie night')
      await page.evaluate(() => window.scrollTo(0, 0))
      await shot('joined-feed')
      await openMenu()
      await page.getByRole('menuitem', { name: 'Leave' }).click()
      await sleep(600)
      await shot('leave-confirm')
      await cancelAsk()
      await page.getByRole('button', { name: /^Share/ }).first().click()
      await sleep(700)
      await shot('share-as-member')
      await page.keyboard.press('Escape')
      await sleep(500)
    },
  ],
  [
    'bell',
    async ({ page, width, shot, pickFeed }) => {
      await page.evaluate(() => window.scrollTo(0, 0))
      await pickFeed('Our house')
      const bell = page.locator('a[href="#needs-attention"]')
      await bell.hover()
      await sleep(900)
      await shot('bell-tip', { clip: { x: 0, y: 0, width, height: 140 } })
      await bell.click()
      await sleep(1200)
      await shot('bell-opened')
      await shot('bell-opened-full', { fullPage: true })
    },
  ],
  [
    'icon-tips',
    async ({ page, width, phone, shot, away }) => {
      if (phone) return 'hidden on a phone'
      await page.locator('a[aria-label="LunarWerx Studios"]').hover()
      await sleep(400)
      await shot('tip-lunarwerx', { clip: { x: 0, y: 0, width, height: 120 } })
      await page.locator('header a[href*="github"]').first().hover()
      await sleep(400)
      await shot('tip-github', { clip: { x: 0, y: 0, width, height: 120 } })
      await away()
    },
  ],
  [
    'title-popup',
    async ({ page, shot, pickFeed }) => {
      await pickFeed('Our house')
      await page.locator('#on-it-title').scrollIntoViewIfNeeded()
      await page.locator('section[aria-labelledby="on-it-title"] ul button').first().click()
      await sleep(2500)
      await shot('title-popup')
      await page.keyboard.press('Escape')
      await sleep(800)
    },
  ],
  [
    'scrolled',
    async ({ page, shot }) => {
      await page.evaluate(() => window.scrollTo(0, 700))
      await sleep(700)
      await shot('scrolled-700')
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(500)
    },
  ],
  [
    'down-to-one',
    async ({ page, shot, feedNames, openMenu, yesAsk }) => {
      const gone = []
      for (let i = 0; i < 8; i += 1) {
        const names = await feedNames()
        if (names.length <= 1 && !(await page.locator('nav[aria-label="Your feeds"]').count())) break
        if (names.length <= 1) break
        await page.evaluate(() => window.scrollTo(0, 0))
        await openMenu()
        const item = page.getByRole('menuitem').last()
        const label = (await item.innerText()).trim()
        gone.push(label)
        await item.click()
        await sleep(600)
        await yesAsk(label)
        await sleep(900)
      }
      await sleep(800)
      await shot('single-feed')
      await shot('single-feed-full', { fullPage: true })
      return gone.join(', ')
    },
  ],
  [
    'first-run',
    async ({ page, shot, openMenu, yesAsk }) => {
      await page.evaluate(() => window.scrollTo(0, 0))
      await openMenu()
      const lastItem = page.getByRole('menuitem').last()
      const label = (await lastItem.innerText()).trim()
      await lastItem.click()
      await sleep(600)
      await yesAsk(label)
      await sleep(1500)
      await shot('first-run')
      await page.locator('section[aria-labelledby="first-feed-title"] p button').first().click()
      await sleep(700)
      await shot('first-run-example')
      await page.getByRole('button', { name: 'Add another list' }).click()
      await sleep(700)
      await shot('first-run-another')
    },
  ],
  [
    'made',
    async ({ page, shot }) => {
      await page.getByRole('button', { name: 'Remove link 2' }).click()
      await sleep(500)
      await page.getByRole('button', { name: 'Make feed' }).click()
      await sleep(2500)
      await shot('made-feed')
      await shot('made-feed-full', { fullPage: true })
    },
  ],
]

async function runCombo(browser, { width, theme, rm }) {
  const id = `${width}-${theme}${rm ? '-rm' : ''}`
  const dir = join(OUT, id)
  mkdirSync(dir, { recursive: true })
  const phone = width < 768
  const context = await browser.newContext({
    viewport: { width, height: phone ? 812 : width === 768 ? 1024 : 900 },
    deviceScaleFactor: 1,
    colorScheme: theme,
    reducedMotion: rm ? 'reduce' : 'no-preference',
    isMobile: phone,
    hasTouch: phone,
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  await context.addInitScript((t) => {
    try {
      if (!sessionStorage.getItem('qa-init')) {
        localStorage.setItem('theme', t)
        localStorage.removeItem('watcharr:feeds-pinned')
        sessionStorage.setItem('qa-init', '1')
      }
    } catch {}
  }, theme)
  const page = await context.newPage()
  const log = { id, steps: [], console: [] }
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') log.console.push(`${m.type()}: ${m.text()}`.slice(0, 400))
  })
  page.on('pageerror', (e) => log.console.push(`pageerror: ${e.message}`.slice(0, 400)))
  page.on('response', (r) => {
    if (r.status() >= 400) log.console.push(`http ${r.status()}: ${r.url()}`.slice(0, 300))
  })
  let n = 0
  const shot = async (name, opts = {}) => {
    n += 1
    const file = join(dir, `${String(n).padStart(2, '0')}-${name}.png`)
    await page.screenshot({ path: file, animations: 'allow', caret: 'initial', timeout: 15000, ...opts })
    return file
  }
  const step = async (name, fn) => {
    if (ONLY.length && !ONLY.includes(name)) return
    const started = Date.now()
    try {
      const note = await fn()
      log.steps.push({ name, ok: true, ms: Date.now() - started, note: note ?? null })
    } catch (error) {
      log.steps.push({ name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error).split('\n')[0] })
      await page.keyboard.press('Escape').catch(() => {})
      await sleep(300)
    }
  }
  const away = () => page.mouse.move(width - 5, phone ? 700 : 850)
  const railNav = () => page.locator('nav[aria-label="Your feeds"]').nth(1)
  const pillsNav = () => page.locator('nav[aria-label="Your feeds"]').nth(0)
  const feedButtons = () => (phone ? pillsNav().locator('button[aria-current], button:not(:has-text("New feed"))') : railNav().locator('ul button'))
  const feedNames = async () =>
    page.evaluate((isPhone) => {
      const nav = document.querySelectorAll('nav[aria-label="Your feeds"]')[isPhone ? 0 : 1]
      if (!nav) return []
      const buttons = isPhone ? [...nav.querySelectorAll('button')].filter((b) => !/New feed/.test(b.textContent)) : [...nav.querySelectorAll('ul button')]
      return buttons.map((b) => (isPhone ? b.textContent.trim() : b.querySelector('.truncate')?.textContent?.trim() ?? ''))
    }, phone)
  const pickFeed = async (name) => {
    const names = await feedNames()
    const index = names.findIndex((x) => x.startsWith(name))
    if (index < 0) throw new Error(`no feed "${name}" in [${names.join(' | ')}]`)
    if (!phone) await railNav().hover()
    await feedButtons().nth(index).click()
    await away()
    await sleep(700)
  }
  const sectionClip = async (selector, pad = 16, extraBelow = 0) => {
    const box = await page.locator(selector).first().boundingBox()
    if (!box) throw new Error(`no box for ${selector}`)
    const y = Math.max(0, box.y - pad)
    return { x: 0, y, width, height: Math.min(box.height + pad * 2 + extraBelow, 1400) }
  }
  const openMenu = async () => {
    await page.locator('button[aria-label^="More for"]').first().click()
    await sleep(350)
  }
  const cancelAsk = async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await sleep(450)
  }
  const yesAsk = async (label) => {
    await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click()
    await sleep(900)
  }

  const helpers = { page, width, phone, shot, away, railNav, pillsNav, feedButtons, feedNames, pickFeed, sectionClip, openMenu, cancelAsk, yesAsk }

  await page.goto(`${BASE}/?demo`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#feed-title', { timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await sleep(1500)
  log.feeds = await feedNames()

  for (const [name, fn] of STEPS) await step(name, () => fn(helpers))

  await context.close()
  return log
}

const browser = await chromium.launch({ channel: 'chromium', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const combos = COMBOS.filter((c) => !FILTER.length || FILTER.includes(`${c.width}-${c.theme}${c.rm ? '-rm' : ''}`))
const results = []
try {
  for (let i = 0; i < combos.length; i += 4) {
    results.push(...(await Promise.all(combos.slice(i, i + 4).map((combo) => runCombo(browser, combo).catch((e) => ({ id: combo, fatal: String(e) }))))))
  }
} finally {
  await browser.close()
}
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, `report${FILTER.length ? '-' + FILTER.join('_') : ''}.json`), JSON.stringify(results, null, 2))
for (const r of results) {
  const bad = (r.steps ?? []).filter((s) => !s.ok)
  console.log(`${typeof r.id === 'string' ? r.id : JSON.stringify(r.id)}: ${r.fatal ? 'FATAL ' + r.fatal : `${(r.steps ?? []).length - bad.length} ok, ${bad.length} failed`}${bad.map((s) => `\n   x ${s.name}: ${s.error}`).join('')}${r.console?.length ? `\n   console: ${r.console.length} (${r.console.slice(0, 3).join(' || ')})` : ''}`)
}
