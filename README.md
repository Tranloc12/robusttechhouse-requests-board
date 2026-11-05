# Requests board: starter kit

The rules are in the brief on your invitation page. Everything else is here.

```
docs/rules.md       the brief's rules with the exact field names
docs/api.md         the helpdesk API your app reads (from the browser)
starters/           a runnable starter in React and in Vue, both TypeScript + Vite + Vitest: pick one
DECISIONS.md        fill this in; it is part of your submission
.env.example        copy to .env and paste in your practice API details
```

## Setup

You need Node 20+ and Git.

```bash
git init && git add -A && git commit -m "chore: start from the kit"
cp -r starters/react-vite/. . && rm -r starters   # or starters/vue-vite
cp .env.example .env                              # paste in HELPDESK_URL and HELPDESK_TOKEN
npm install
npm run dev                                       # http://localhost:5173
npm test                                          # exit 0 = pass
```

Check the API works:

```bash
curl -H "Authorization: Bearer $HELPDESK_TOKEN" "$HELPDESK_URL/v1/statuses"
```

You may change anything in the starter, add libraries, or start from your own Vite project. Keep
these working at the repo root, because a script checks them before anyone reads your code:

| Check | Command |
| --- | --- |
| Builds | `npm ci && npm run build` |
| Tests pass | `npm test` |
| Type-checks | `npx tsc --noEmit` |
| Complete | `DECISIONS.md` with its four headings, at least 5 commits, a video link, no secrets in the code |

`.env` is ignored by git; keep it that way. The app reads `HELPDESK_URL` and `HELPDESK_TOKEN` from
`import.meta.env` (see `vite.config.ts`).

## Submitting

1. Commit as you go (at least 5 commits); we read the history.
2. Fill in `DECISIONS.md`.
3. Record a short screen recording (about 3 minutes) of the app, narrated in English.
4. Push to a **public** repo (e.g. GitHub) and paste the link on your invitation page, or zip the
   folder **including `.git`** (leave out `node_modules` and `.env`) and upload it there.

Cap it at 3 hours. Go through the levels in order and say in `DECISIONS.md` what you'd do next.
**Submit even if it's unfinished:** we review everything you did, not only the final result.
A plain table is enough; polish isn't scored. We never reuse submissions as company work.
