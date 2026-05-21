# Fathom

A two-player fog-of-war board game where the only way to win is to capture an opponent's piece. Moves are hidden until guessed; the board is gradually exposed by monsoons. Stack: React + Vite frontend, Express 5 API server, PostgreSQL + Drizzle ORM.

---

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000/8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only, requires TTY)
- Required env: `DATABASE_URL` — Postgres connection string

---

## Full Game Rules

### Board
- **7 × 6 grid**: columns A–G (0–6), rows 1–6 from each player's own perspective.
- Both players always see the board from their **own perspective**: row 1 is your home row, row 6 is the opponent's home row.
- Absolute coordinates (0–5) are used server-side. Perspective coordinates (1–6) are used in the API and UI.
- **Coordinate conversion**:
  - P1: `absRow = 6 − perspRow`  (P1's row 1 → abs 5, row 6 → abs 0)
  - P2: `absRow = perspRow − 1`  (P2's row 1 → abs 0, row 6 → abs 5)

### Pieces
- Each player has **2 pieces**.
- Pieces move **king-style**: one square in any direction (including diagonal).
- Pieces begin **unplaced**. Their first move must place them on their home row (row 1 / perspective).
- A piece's **stride count** increments by +1 for each forward move survived and +1 for each non-pass wrong guess survived. Stride is cosmetic — it conveys how confident/deep a piece is.
- A captured piece is permanently removed (`isAlive: false`).

### Winning — Capture Only
**The only way to win is to capture an opponent's piece.** There are two capture paths:

1. **Trap capture (correct guess)**
   - After the mover commits their hidden move, the guesser names a square.
   - If the guesser correctly identifies the mover's destination, the mover's piece is captured at that square and the guesser wins immediately.
   - The move still "happens" — the piece traveled there and was ambushed.

2. **Collision capture (landing on an opponent)**
   - If the mover's piece travels to a square currently occupied by a live opponent piece, the opponent's piece is captured and the mover wins immediately.
   - This can happen regardless of whether the opponent piece is visible. It is a high-risk, high-reward move into fog.

No other conditions end the game (no crossing win, no stride timeout, no monsoon stalemate).

### Turn Sequence (Commit / Guess / Reveal)
Each turn has two phases:

1. **commit_move** — The **mover** secretly selects a piece and destination, then presses "Commit Move". The move is stored server-side but hidden from the opponent.
2. **commit_guess** — The **guesser** (the non-mover) either:
   - Names a square they think the mover went to ("Commit Guess"), or
   - Passes ("Pass"), conceding the turn with no trap risk.
3. Server resolves immediately on guess submission: capture or move-success.
4. Turn flips. After both players have acted, the **round** increments.

### Monsoon — Row Exposure
Every 4 full rounds (after rounds 4, 8, 12), the **monsoon** triggers:

| Monsoon | Exposed absolute rows | Perspective rows (both players) |
|---------|----------------------|----------------------------------|
| 1st (after round 4) | 0 and 5 | rows 1 and 6 of each player |
| 2nd (after round 8) | 0, 1, 4, 5 | rows 1, 2, 5, 6 |
| 3rd (after round 12) | 0, 1, 2, 3, 4, 5 | all rows |

**Exposed rows are visible to both players.** Any piece sitting on an exposed row has its position shown to the opponent. If a piece moves off an exposed row, it becomes hidden again (unless permanently revealed by other means).

The board is never reduced — all 6 rows remain playable at all times. Exposure only affects visibility.

### Fog of War
- Your pieces are always visible to you.
- Opponent pieces are hidden by default (`isVisible: false`).
- An opponent piece becomes visible when:
  - It is on an **exposed row** (monsoon-revealed).
  - It was involved in a **collision** (both pieces become visible).
  - It was a target of a **correct guess** (piece revealed at capture site).
- Visibility can become permanent (`isVisible: true` in DB) for captured/collision pieces.

### Game Flow Diagram
```
Game created (P1 waiting)
        │
P2 joins → status: active, P1 moves first
        │
   ┌────▼────────────────────────┐
   │  commit_move phase          │
   │  Mover picks piece + dest   │
   │  (stored hidden)            │
   └────────────┬────────────────┘
                │ move committed
   ┌────────────▼────────────────┐
   │  commit_guess phase         │
   │  Guesser names a square     │
   │  (or passes)                │
   └────────────┬────────────────┘
                │
         Resolve turn
        /              \
  Guess correct?      Guess wrong / pass
  → Capture mover     → Move succeeds
  → Guesser wins      Check collision?
                      /         \
               Collided      No collision
               → Capture      → Next turn
               → Mover wins    (flip mover)
                                │
                       After P2 acts → round++
                       Every 4 rounds → monsoon
                       (expose outer rows)
```

---

## Architecture

### Stack
- **pnpm workspaces**, Node.js 24, TypeScript 5.9
- **API**: Express 5 at `/api` (port 8080 dev)
- **DB**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (OpenAPI → React Query hooks + Zod schemas)
- **Frontend**: React + Vite, React Query, Wouter routing, Tailwind CSS, shadcn/ui

### Where Things Live
```
artifacts/
  api-server/
    src/
      lib/game-engine.ts      ← ALL game logic (validation, resolution, state)
      routes/games/index.ts   ← All game HTTP endpoints
      routes/index.ts         ← Router mount
  fathom/
    src/
      pages/home.tsx          ← Lobby: create/join game
      pages/game.tsx          ← Full board + action controls + sidebar
lib/
  api-spec/openapi.yaml       ← Source of truth for API contract
  api-client-react/           ← Generated React Query hooks (do not edit)
  api-zod/                    ← Generated Zod schemas (do not edit)
  db/
    src/schema/games.ts       ← DB schema (source of truth for types)
```

### Database Schema
**`games`** table — one row per game:
- `id`, `status` (waiting / active / finished)
- `player1_token`, `player2_token` — UUID secrets used as auth
- `current_turn_player`, `phase` (commit_move / commit_guess / finished)
- `round` — full-round counter (increments when mover flips back to P1)
- `exposed_rows` — JSON text array of absolute row indices exposed by monsoon (e.g. `[0,5]`)
- `winner`, `win_condition` (capture / forfeit)
- `pending_move_*` — hidden committed move (piece index, col, abs row)
- `pending_guess_*` — guesser's committed guess (pass flag, col, abs row)

**`game_pieces`** table — 4 rows per game (2 per player):
- `player`, `piece_index`, `is_placed`, `is_alive`, `col`, `row` (absolute), `stride_count`, `is_visible`

**`game_events`** table — append-only log:
- `seq`, `round`, `event_type`, `data` (jsonb)
- Event types: `game_start`, `piece_placed`, `move_success`, `guess_correct`, `guess_wrong`, `pass`, `capture`, `collision`, `row_exposed`, `forfeit`

**`proximity_reveals`** table — kept for future use (not currently generated).

### Trusted Server Model
No zero-knowledge proofs or FHE. The server is trusted:
- The server knows all piece positions at all times.
- Players only receive their own perspective via `buildGameState()`.
- Player identity is verified via UUID token in `X-Player-Token` header (stored in `localStorage`).

### Key Design Decisions
1. **Perspective vs absolute rows**: The API always returns perspective coordinates to each player. The server converts inbound perspective rows to absolute via `perspToAbs()` before storing/comparing, and converts back via `absToPers()` on read.
2. **Move hidden until guess**: After `submit-move`, the destination is stored in `pending_move_*` columns (not sent to any client). It is only compared server-side during `submit-guess`.
3. **Single-round resolution**: The entire commit → guess → resolve loop happens within a single `submit-guess` request. No async resolution or waiting state beyond the move-committed phase.
4. **Exposure not deletion**: Monsoon marks rows in `exposed_rows` JSON. Piece visibility is computed dynamically in `buildGameState()` — if `piece.row ∈ exposedRows`, the opponent can see it regardless of `isVisible` DB flag.
5. **Capture = instant win**: Any piece capture ends the game immediately. No partial state. The winning move and its resolution happen atomically in `resolveTurn()`.

---

## User Preferences
- Bioluminescent teal/cyan on deep navy/black aesthetic ("Void" theme)
- Win condition: capture only (no crossing, stride timeout, or monsoon stalemate)
- Monsoon: row exposure (not board shrinkage)

## Gotchas
- Always run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` after schema changes.
- `pnpm --filter @workspace/db run push` requires a TTY — use raw SQL via `executeSql` in code_execution when running non-interactively.
- After changing `openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen` before typechecking the frontend.
- The `X-Player-Token` header must be passed with every authenticated request. It is stored in `localStorage` keyed by `fathom-token-${gameId}`.
- `exposed_rows` in the DB is a JSON text column (not a native array). Always `JSON.parse()` before use in the engine and `JSON.stringify()` before writing.

## Pointers
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
