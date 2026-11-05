# React starter

Vite + React 18 + TypeScript + Vitest. `src/api.ts` is a thin client for the helpdesk API,
`src/lib/dates.ts` has date helpers with tests, `src/App.tsx` shows one page of requests.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # vitest --run
npm run typecheck    # tsc --noEmit
npm run build
```

No router or state library is included; add what you like.
