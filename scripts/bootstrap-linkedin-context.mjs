import Browserbase from '@browserbasehq/sdk'
import { chromium } from 'playwright-core'

const apiKey = process.env.BROWSERBASE_API_KEY
const projectId = process.env.BROWSERBASE_PROJECT_ID
const targetUrl = process.argv[2] || 'https://www.linkedin.com/in/jaimin-patel007/'

if (!apiKey) throw new Error('BROWSERBASE_API_KEY is required')

const browserbase = new Browserbase({ apiKey })
const context = process.env.BROWSERBASE_LINKEDIN_CONTEXT_ID
  ? await browserbase.contexts.retrieve(process.env.BROWSERBASE_LINKEDIN_CONTEXT_ID)
  : await browserbase.contexts.create({
  name: `gptinder-linkedin-${Date.now()}`,
  projectId: projectId || undefined,
})
const session = await browserbase.sessions.create({
  projectId: projectId || undefined,
  api_timeout: 600,
  browserSettings: {
    allowedDomains: ['linkedin.com'],
    blockAds: true,
    recordSession: false,
    logSession: false,
    context: { id: context.id, persist: true },
  },
  userMetadata: { feature: 'linkedin-context-bootstrap' },
})
const live = await browserbase.sessions.debug(session.id)

console.log(`CONTEXT_ID=${context.id}`)
console.log(`SESSION_ID=${session.id}`)
console.log(`LIVE_VIEW_URL=${live.debuggerFullscreenUrl}`)
console.log('Open LIVE_VIEW_URL and sign in to LinkedIn. This process will continue automatically.')

let browser
try {
  browser = await chromium.connectOverCDP(session.connectUrl)
  const browserContext = browser.contexts()[0] || await browser.newContext()
  const page = browserContext.pages()[0] || await browserContext.newPage()
  await page.goto('https://www.linkedin.com/login', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })

  const deadline = Date.now() + 8 * 60_000
  let authenticated = false
  while (Date.now() < deadline) {
    const cookies = await browserContext.cookies('https://www.linkedin.com')
    authenticated = cookies.some((cookie) => cookie.name === 'li_at' && cookie.value.length > 0)
    if (authenticated) break
    await page.waitForTimeout(2_000)
  }

  if (!authenticated) throw new Error('Timed out before LinkedIn authentication completed')

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(3_000)
  const profileEvidence = await page.locator('main, [role="main"]').first().innerText().catch(() => '')
  const finalUrl = page.url().toLowerCase()
  if (/\/(login|signup|authwall|checkpoint)(\/|\?|$)/.test(finalUrl)) {
    throw new Error('LinkedIn redirected the authenticated context back to a login wall')
  }
  if (!profileEvidence.toLowerCase().includes('jaimin patel')) {
    throw new Error('The authenticated session did not expose the requested LinkedIn profile')
  }

  console.log('AUTHENTICATED=1')
  console.log('PROFILE_VERIFIED=1')
} finally {
  await browser?.close().catch(() => undefined)
}

await new Promise((resolve) => setTimeout(resolve, 5_000))
console.log('READY=1')
