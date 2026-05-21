import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  gamesTable,
  gamePiecesTable,
  gameEventsTable,
  proximityRevealsTable,
} from "@workspace/db";
import {
  CreateGameBody,
  JoinGameBody,
  SubmitMoveBody,
  SubmitGuessBody,
} from "@workspace/api-zod";
import {
  perspToAbs,
  validateMove,
  resolveTurn,
  buildGameState,
  homeRowAbs,
  opponent,
} from "../../lib/game-engine";

const router: IRouter = Router();

// ─── GET /games ──────────────────────────────────────────────────────────────

router.get("/games", async (_req, res): Promise<void> => {
  const games = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.status, "waiting"))
    .orderBy(gamesTable.createdAt);

  res.json(
    games.map(g => ({
      id: g.id,
      status: g.status,
      createdAt: g.createdAt.toISOString(),
      player1Name: g.player1Name,
      round: g.round,
    }))
  );
});

// ─── POST /games ─────────────────────────────────────────────────────────────

router.post("/games", async (req, res): Promise<void> => {
  const parsed = CreateGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const gameId = crypto.randomUUID();
  const playerToken = crypto.randomUUID();

  await db.insert(gamesTable).values({
    id: gameId,
    status: "waiting",
    player1Token: playerToken,
    player1Name: parsed.data.playerName,
    exposedRows: "[]",
  });

  await db.insert(gamePiecesTable).values([
    { gameId, player: 1, pieceIndex: 0 },
    { gameId, player: 1, pieceIndex: 1 },
  ]);

  res.status(201).json({
    gameId,
    playerToken,
    playerNumber: 1,
    playerName: parsed.data.playerName,
  });
});

// ─── GET /games/:id ──────────────────────────────────────────────────────────

router.get("/games/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const playerToken = Array.isArray(req.headers["x-player-token"])
    ? req.headers["x-player-token"][0]
    : req.headers["x-player-token"] ?? null;

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, rawId));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const pieces = await db.select().from(gamePiecesTable).where(eq(gamePiecesTable.gameId, rawId));
  const proximity = await db
    .select()
    .from(proximityRevealsTable)
    .where(eq(proximityRevealsTable.gameId, rawId));

  const spectate = req.query["spectate"] === "true" || req.query["spectate"] === "1";
  res.json(buildGameState(game, pieces, proximity, playerToken as string | null, spectate));
});

// ─── POST /games/:id/join ─────────────────────────────────────────────────────

router.post("/games/:id/join", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const parsed = JoinGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, rawId));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  if (game.status !== "waiting") {
    res.status(400).json({ error: "Game is not open for joining" });
    return;
  }

  const playerToken = crypto.randomUUID();

  await db
    .update(gamesTable)
    .set({
      status: "active",
      player2Token: playerToken,
      player2Name: parsed.data.playerName,
      phase: "commit_move",
      currentTurnPlayer: 1,
    })
    .where(eq(gamesTable.id, rawId));

  await db.insert(gamePiecesTable).values([
    { gameId: rawId, player: 2, pieceIndex: 0 },
    { gameId: rawId, player: 2, pieceIndex: 1 },
  ]);

  await db.insert(gameEventsTable).values({
    gameId: rawId,
    seq: 1,
    round: 1,
    eventType: "game_start",
    data: {
      player1: game.player1Name,
      player2: parsed.data.playerName,
      message: "Game started! Player 1 moves first. Only capture wins.",
    },
  });

  res.json({
    gameId: rawId,
    playerToken,
    playerNumber: 2,
    playerName: parsed.data.playerName,
  });
});

// ─── POST /games/:id/submit-move ─────────────────────────────────────────────

router.post("/games/:id/submit-move", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const playerToken = Array.isArray(req.headers["x-player-token"])
    ? req.headers["x-player-token"][0]
    : req.headers["x-player-token"];

  if (!playerToken) {
    res.status(403).json({ error: "Player token required" });
    return;
  }

  const parsed = SubmitMoveBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, rawId));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  let playerNum: number;
  if (playerToken === game.player1Token) playerNum = 1;
  else if (playerToken === game.player2Token) playerNum = 2;
  else {
    res.status(403).json({ error: "Invalid player token" });
    return;
  }

  const pieces = await db.select().from(gamePiecesTable).where(eq(gamePiecesTable.gameId, rawId));
  const destAbsRow = perspToAbs(parsed.data.row, playerNum);

  const validation = validateMove(game, pieces, playerNum, parsed.data.pieceIndex, parsed.data.col, destAbsRow);
  if (!validation.valid) {
    res.status(400).json({ error: validation.reason });
    return;
  }

  await db
    .update(gamesTable)
    .set({
      phase: "commit_guess",
      pendingMovePieceIndex: parsed.data.pieceIndex,
      pendingMoveCol: parsed.data.col,
      pendingMoveRow: destAbsRow,
    })
    .where(eq(gamesTable.id, rawId));

  res.json({ success: true, message: "Move committed. Waiting for opponent to guess." });
});

// ─── POST /games/:id/submit-guess ────────────────────────────────────────────

router.post("/games/:id/submit-guess", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const playerToken = Array.isArray(req.headers["x-player-token"])
    ? req.headers["x-player-token"][0]
    : req.headers["x-player-token"];

  if (!playerToken) {
    res.status(403).json({ error: "Player token required" });
    return;
  }

  const parsed = SubmitGuessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!parsed.data.pass && (parsed.data.col == null || parsed.data.row == null)) {
    res.status(400).json({ error: "Must provide col and row when not passing" });
    return;
  }

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, rawId));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  let playerNum: number;
  if (playerToken === game.player1Token) playerNum = 1;
  else if (playerToken === game.player2Token) playerNum = 2;
  else {
    res.status(403).json({ error: "Invalid player token" });
    return;
  }

  if (game.status !== "active") {
    res.status(400).json({ error: "Game is not active" });
    return;
  }
  if (game.phase !== "commit_guess") {
    res.status(400).json({ error: "Not in guess phase — mover has not committed yet" });
    return;
  }
  if (playerNum === game.currentTurnPlayer) {
    res.status(403).json({ error: "You are the mover this turn, not the guesser" });
    return;
  }

  const guesserNum = playerNum;
  let guessAbsRow: number | null = null;
  if (!parsed.data.pass && parsed.data.row != null) {
    guessAbsRow = perspToAbs(parsed.data.row, guesserNum);
  }

  const gameWithGuess: typeof game = {
    ...game,
    pendingGuessPass: parsed.data.pass,
    pendingGuessCol: parsed.data.pass ? null : (parsed.data.col ?? null),
    pendingGuessRow: parsed.data.pass ? null : guessAbsRow,
  };

  const pieces = await db.select().from(gamePiecesTable).where(eq(gamePiecesTable.gameId, rawId));
  const outcome = resolveTurn(gameWithGuess, pieces);

  // Apply piece updates
  for (const update of outcome.pieceUpdates) {
    await db
      .update(gamePiecesTable)
      .set(update.changes)
      .where(eq(gamePiecesTable.id, update.id));
  }

  // Save events
  const existingEventsResult = await db
    .select({ seq: gameEventsTable.seq })
    .from(gameEventsTable)
    .where(eq(gameEventsTable.gameId, rawId));
  const maxSeq = existingEventsResult.reduce((m, e) => Math.max(m, e.seq), 0);

  if (outcome.events.length > 0) {
    await db.insert(gameEventsTable).values(
      outcome.events.map((evt, i) => ({
        gameId: rawId,
        seq: maxSeq + i + 1,
        round: game.round,
        eventType: evt.eventType,
        data: evt.data,
      }))
    );
  }

  // Update game state
  const gameUpdates: Record<string, unknown> = {
    ...outcome.gameUpdates,
  };

  if (outcome.gameOver) {
    gameUpdates.status = "finished";
    gameUpdates.phase = "finished";
    gameUpdates.winner = outcome.winner;
    gameUpdates.winCondition = outcome.winCondition;
    gameUpdates.pendingMovePieceIndex = null;
    gameUpdates.pendingMoveCol = null;
    gameUpdates.pendingMoveRow = null;
    gameUpdates.pendingGuessPass = null;
    gameUpdates.pendingGuessCol = null;
    gameUpdates.pendingGuessRow = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db
    .update(gamesTable)
    .set(gameUpdates as any)
    .where(eq(gamesTable.id, rawId));

  let message: string;
  if (outcome.guessCorrect) {
    message = "Trap sprung! Opponent's piece captured. You win!";
  } else if (parsed.data.pass) {
    message = "Passed. Opponent's move succeeds.";
  } else {
    message = "Wrong guess. Opponent slips through.";
  }

  res.json({
    success: true,
    message,
    outcome: {
      guessCorrect: outcome.guessCorrect,
      guessPassed: outcome.guessPassed,
      pieceCaptured: outcome.pieceCaptured,
      collision: outcome.collision,
      monsoonTriggered: outcome.monsoonTriggered,
      newExposedRows: outcome.newExposedRows,
      gameOver: outcome.gameOver,
      winner: outcome.winner,
      winCondition: outcome.winCondition,
    },
  });
});

// ─── POST /games/:id/forfeit ─────────────────────────────────────────────────

router.post("/games/:id/forfeit", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const playerToken = Array.isArray(req.headers["x-player-token"])
    ? req.headers["x-player-token"][0]
    : req.headers["x-player-token"];

  if (!playerToken) {
    res.status(403).json({ error: "Player token required" });
    return;
  }

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, rawId));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  let playerNum: number;
  if (playerToken === game.player1Token) playerNum = 1;
  else if (playerToken === game.player2Token) playerNum = 2;
  else {
    res.status(403).json({ error: "Invalid player token" });
    return;
  }

  if (game.status !== "active" && game.status !== "waiting") {
    res.status(400).json({ error: "Game is already finished" });
    return;
  }

  const winnerNum = opponent(playerNum);

  await db
    .update(gamesTable)
    .set({
      status: "finished",
      phase: "finished",
      winner: winnerNum,
      winCondition: "forfeit",
    })
    .where(eq(gamesTable.id, rawId));

  const existingEvents = await db
    .select({ seq: gameEventsTable.seq })
    .from(gameEventsTable)
    .where(eq(gameEventsTable.gameId, rawId));
  const maxSeq = existingEvents.reduce((m, e) => Math.max(m, e.seq), 0);

  await db.insert(gameEventsTable).values({
    gameId: rawId,
    seq: maxSeq + 1,
    round: game.round,
    eventType: "forfeit",
    data: { player: playerNum, message: `Player ${playerNum} forfeited.` },
  });

  res.json({ success: true, message: "Game forfeited." });
});

// ─── GET /games/:id/events ───────────────────────────────────────────────────

router.get("/games/:id/events", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, rawId));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const events = await db
    .select()
    .from(gameEventsTable)
    .where(eq(gameEventsTable.gameId, rawId))
    .orderBy(gameEventsTable.seq);

  res.json(
    events.map(e => ({
      seq: e.seq,
      round: e.round,
      eventType: e.eventType,
      timestamp: e.createdAt.toISOString(),
      data: e.data as Record<string, unknown>,
    }))
  );
});

// ─── GET /games/:id/proximity-history ────────────────────────────────────────

router.get("/games/:id/proximity-history", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, rawId));
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  const reveals = await db
    .select()
    .from(proximityRevealsTable)
    .where(eq(proximityRevealsTable.gameId, rawId))
    .orderBy(proximityRevealsTable.round);

  res.json(
    reveals.map(r => ({
      round: r.round,
      col: r.col,
      row: r.row,
      result: r.result,
    }))
  );
});

export default router;
