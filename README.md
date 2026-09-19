# gptinder

This is a [Next.js](https://nextjs.org) project bootstrapped with [v0](https://v0.app).

## Built with v0

This repository is linked to a [v0](https://v0.app) project. You can continue developing by visiting the link below -- start new chats to make changes, and v0 will push commits directly to this repo. Every merge to `main` will automatically deploy.

[Continue working on v0 →](https://v0.app/chat/projects/prj_x5RUpsvNaKjJVpiyoM6I9Qvh5g9a)

## Public profile imports

The profile form uses a Browserbase cloud browser to import publicly visible
Instagram, LinkedIn, and X profile data. It captures the profile, visible posts,
expanded visible comments/replies, and profile sections such as LinkedIn
experience and education, then stores normalized records plus the raw public
page snapshots in MongoDB. Credentials never reach the browser client.

Copy `.env.example` to `.env.local` and set:

```bash
MONGODB_URI="mongodb+srv://..."
MONGODB_DB="gptinder"
BROWSERBASE_API_KEY="..."
# Optional for older/unscoped Browserbase keys:
BROWSERBASE_PROJECT_ID="..."
# Required for LinkedIn imports after logging in once through Browserbase Live View:
BROWSERBASE_LINKEDIN_CONTEXT_ID="..."
PROFILE_IMPORT_MAX_POSTS="12"
```

For Vercel, add the same values under Project Settings → Environment Variables.
Use a MongoDB Atlas database user scoped to this application and allow network
access from Vercel. The app creates these collections and indexes on first use:

- `social_profiles`: one document per platform and handle, including the public
  provider snapshot
- `social_posts`: normalized post text, source URL, media/engagement metadata,
  and the Browserbase page snapshot
- `social_comments`: visible comments/replies linked by profile and post ID
- `social_profile_sections`: experience, education, certification, project,
  skills, and other visible profile sections
- `profile_media.files` / `profile_media.chunks`: a GridFS copy of the profile
  photo when the public image can be downloaded safely
- `profile_imports`: a small append-only import audit record

The importer accepts Instagram person profiles, LinkedIn `/in/` person profiles,
and X profile URLs. LinkedIn requires a user-approved authenticated Browserbase
Context because LinkedIn returns a signup wall to clean cloud browsers. The
importer rejects login walls instead of storing them as profiles, and the import
audit records the exact URLs and counts Browserbase discovered and stored.

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
