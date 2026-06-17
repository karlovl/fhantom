# fhantom(Devourer)

A two-player fog-of-war board game. Move in secret, guess your opponent's destination, capture their pieces to win.

## Stack

- **Frontend**: React + Vite, React Query, Wouter, Tailwind CSS, shadcn/ui
- **API**: Express 5 (TypeScript), port 8080
- **Database**: PostgreSQL + Drizzle ORM
- **Package manager**: pnpm workspaces, Node.js 24

## Setup

```bash
pnpm install
```

Required env: `DATABASE_URL` — Postgres connection string.

## Commands

```bash
pnpm --filter @workspace/api-server run dev   # start API server
pnpm run typecheck                             # typecheck all packages
pnpm run build                                 # typecheck + build all
pnpm --filter @workspace/db run push          # push DB schema (dev, requires TTY)
pnpm --filter @workspace/api-spec run codegen # regenerate API client from openapi.yaml
```

## Key Files

| Path | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/game-engine.ts` | All game logic |
| `artifacts/api-server/src/routes/games/index.ts` | Game HTTP endpoints |
| `artifacts/fathom/src/pages/game.tsx` | Board UI |
| `lib/api-spec/openapi.yaml` | API contract (source of truth) |
| `lib/db/src/schema/games.ts` | DB schema (source of truth) |

## Notes

- After editing `openapi.yaml`, run codegen before typechecking the frontend.
- Run `pnpm run typecheck:libs` before the API server typecheck after schema changes.
- `api-client-react/` and `api-zod/` under `lib/` are generated — do not edit directly.
