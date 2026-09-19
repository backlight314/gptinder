# AI Matchmaker

Next.js + MongoDB Atlas + Vercel Workflows + server-side OpenAI, with a Lua Hacker Badge / Web Serial bridge.

Start with [Vercel, Atlas and demo setup](docs/SETUP.md) and [badge installation](docs/BADGE.md). Copy `.env.example` to `.env.local`, provide your credentials, then use Node.js 24 and pnpm 12.3.4:

```sh
pnpm install --frozen-lockfile
pnpm db:indexes
pnpm db:check
pnpm dev
```

The app supports verified email sign-in/recovery, TIPI plus five adaptive questions, reviewable profiles, optional browser-selected WhatsApp/writing/professional-text imports, versioned communication style, comparative persona previews, six-turn encounters, transparent directional scoring, and confirmed preference learning. Email delivery uses Resend; no mailbox access, private archive scraping, or separate worker is required. Seeded fictional demo accounts can use private sign-in keys.

```sh
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:http
```

Integration tests start a disposable MongoDB replica set and mock model responses. Lua tests run the actual badge source with documented API doubles. Live OpenAI/Vercel execution and physical badges require a deployment rehearsal.
