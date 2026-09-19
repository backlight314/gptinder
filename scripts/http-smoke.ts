import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { collections, ensureIndexes, closeClient } from '../lib/server/db'
import { hashSecret } from '../lib/server/auth'

async function main() {
  assert(
    existsSync('.next/BUILD_ID'),
    'Run pnpm build before the HTTP smoke test.',
  )
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  assert(address && typeof address !== 'string')
  const port = address.port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  const origin = `http://127.0.0.1:${port}`
  process.env.MONGODB_URI = replica.getUri()
  process.env.MONGODB_DB = `gptinder_http_test_${Date.now()}`
  process.env.AUTH_SECRET = randomBytes(32).toString('hex')
  process.env.APP_URL = origin
  let server: ReturnType<typeof spawn> | undefined
  try {
    await ensureIndexes()
    server = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      {
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          ALLOW_DEMO_AUTH: 'false',
          APP_URL: origin,
          NEXT_TELEMETRY_DISABLED: '1',
        },
      },
    )
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if ((await fetch(origin)).ok) {
          ready = true
          break
        }
      } catch {
        /* Wait for the owned test server. */
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert(ready, 'Production server did not start within 15 seconds.')
    assert.equal((await fetch(`${origin}/api/me`)).status, 401)
    const body = JSON.stringify({
      action: 'register',
      displayName: 'HTTP smoke user',
      adult: true,
    })
    const blocked = await fetch(`${origin}/api/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://other.invalid',
      },
      body,
    })
    assert.equal(blocked.status, 403)
    const created = await fetch(`${origin}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body,
    })
    assert.equal(
      created.status,
      403,
      'Production must require verified email registration',
    )
    const token = randomBytes(32).toString('hex')
    await (
      await collections()
    ).loginTokens.insertOne({
      _id: hashSecret(token),
      email: 'http-smoke@example.com',
      displayName: 'HTTP smoke user',
      expiresAt: new Date(Date.now() + 60000),
    })
    const redeem = () =>
      fetch(`${origin}/api/auth/email`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ token }),
      })
    const verified = await redeem()
    assert.equal(verified.status, 200)
    assert.equal((await redeem()).status, 401, 'Email code cannot be replayed')
    const cookie = verified.headers.get('set-cookie')?.split(';')[0]
    assert(cookie)
    const me = await fetch(`${origin}/api/me`, { headers: { Cookie: cookie } })
    assert.equal(me.status, 200)
    const state = await me.json()
    assert.equal(state.user.displayName, 'HTTP smoke user')
    assert.equal(state.interview.stage, 'survey')
    assert(!JSON.stringify(state).includes('accessKeyHash'))
    assert.match(me.headers.get('cache-control') ?? '', /no-store/)
    const id = randomUUID()
    await (
      await collections()
    ).imports.insertOne({
      _id: id,
      userId: 'another-user',
      label: 'Private source',
      sourceType: 'writing',
      parserVersion: 'test',
      consent: {
        reviewed: true,
        ownMessagesOnly: true,
        approvedAt: new Date(),
      },
      statistics: {
        count: 0,
        meanWords: 0,
        questionRate: 0,
        emojiRate: 0,
        punctuationPerMessage: 0,
        contractionRate: 0,
      },
      status: 'review',
      revision: 1,
      createdAt: new Date(),
    })
    assert.equal(
      (
        await fetch(`${origin}/api/imports/${id}`, {
          headers: { Cookie: cookie },
        })
      ).status,
      404,
    )
    assert.equal(
      (
        await fetch(`${origin}/api/imports/${id}`, {
          method: 'DELETE',
          headers: { Cookie: cookie, Origin: origin },
        })
      ).status,
      404,
    )
    const lua = await fetch(`${origin}/badge/gptinder.lua`)
    assert.equal(lua.status, 200)
    assert((await lua.text()).includes('slug=gptinder'))
    console.log(
      'HTTP smoke passed: production page, auth, origin checks, session restore, private imports, cache headers and badge download.',
    )
  } finally {
    if (server && server.exitCode === null) {
      server.kill()
      await new Promise<void>((resolve) =>
        server!.once('exit', () => resolve()),
      )
    }
    await closeClient()
    await replica.stop()
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'HTTP smoke failed')
  process.exitCode = 1
})
