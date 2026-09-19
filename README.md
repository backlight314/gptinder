# AI Matchmaker

Next.js + MongoDB Atlas + Vercel Workflows + server-side OpenAI, with a Lua Hacker Badge / Web Serial bridge.

Start with [Vercel, Atlas and demo setup](docs/SETUP.md) and [badge installation](docs/BADGE.md). Copy `.env.example` to `.env.local`, provide your credentials, then use Node.js 24 and pnpm 12.3.4:

```sh
pnpm install --frozen-lockfile
pnpm db:indexes
pnpm db:check
pnpm dev
```

The app supports verified email sign-in/recovery, reviewed profiles, physical badge encounters, six-turn conversations, transparent scoring, and confirmed preference learning. The badge pair elects one delivery leader, so a bump produces one profile-import request through the connected browser bridge.

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:http
```

Integration tests start a disposable MongoDB replica set and mock model responses. Lua tests run the actual badge source with documented API doubles. Live profile scraping, OpenAI/Vercel execution, and physical badges require a deployment rehearsal.
