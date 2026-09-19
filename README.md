# gptinder

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_x5RUpsvNaKjJVpiyoM6I9Qvh5g9a)

## Getting Started

Create a local environment file from the example and fill in the server-only
credentials for the two already-populated persona Vector Stores:

```bash
cp .env.example .env.local
```

`OPENAI_API_KEY`, `OPENAI_VECTOR_STORE_ID_A`, and
`OPENAI_VECTOR_STORE_ID_B` must remain in `.env.local`; they are never sent to
the browser. The app does not create Vector Stores, upload persona material,
or connect to a dating platform.

First, run the development server:

```bash
# This project uses the NVM default configured in ~/.zshrc (currently Node 22).
nvm use default
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [v0 Documentation](https://v0.app/docs) - learn about v0 and how to use it.
