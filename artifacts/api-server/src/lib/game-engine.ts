import type { Game, GamePiece, ProximityReveal } from "@workspace/db";

// ─── Coordinate helpers ───────────────────────────────────────────────────────

/** Convert perspective row (1-6, 1=home) to absolute row (0-5, 0=P2 home, 5=P1 home) */
export function perspToAbs(perspRow: number, player: number): number {
  if (player === 1) return 6 - perspRow; // P1: row 1 → abs 5, row 6 → abs 0
  return perspRow - 1;                   // P2: row 1 → abs 0, row 6 → abs 5
}

/** Convert absolute row (0-5) to perspective row (1-6) */
export function absToPers(absRow: number, player: number): number {
  if (player === 1) return 6 - absRow;
  return absRow + 1;
}

/** Home row (absolute) for a player */
export function homeRowAbs(player: number): number {
  return player === 1 ? 5 : 0;
}

/** Parse the exposedRows JSON string from the DB into a number array */
export function parseExposedRows(json: string): number[] {
  try { return JSON.parse(json) as number[]; }
  catch { return []; }
}

/**
 * Compute which absolute rows are exposed after a given number of monsoons.
 * Monsoon k exposes the kth row from each end:
 *   k=1 → [0, 5]
 *   k=2 → [0, 1, 4, 5]
 *   k=3 → [0, 1, 2, 3, 4, 5]
 */
export function computeExposedRows(monsoonsDone: number): number[] {
  const exposed: number[] = [];
  for (let i = 0; i < monsoonsDone; i++) {
    if (!exposed.includes(i)) exposed.push(i);
    if (!exposed.includes(5 - i)) exposed.push(5 - i);
  }
  return exposed.sort((a, b) => a - b);
}

/** Check if a move is valid king movement (1 step in any direction) */
export function isKingMove(
  fromCol: number, fromAbsRow: number,
  toCol: number, toAbsRow: number
): boolean {
  const dc = Math.abs(toCol - fromCol);
  const dr = Math.abs(toAbsRow - fromAbsRow);
  return dc <= 1 && dr <= 1 && (dc + dr > 0);
}

// ─── Opponent helper ──────────────────────────────────────────────────────────

export function opponent(player: number): number {
  return player === 1 ? 2 : 1;
}

// ─── Move validation ──────────────────────────────────────────────────────────

export type MoveValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

export function validateMove(
  game: Game,
  pieces: GamePiece[],
  playerNum: number,
  pieceIndex: number,
  destCol: number,
  destAbsRow: number
): MoveValidationResult {
  if (game.status !== "active") return { valid: false, reason: "Game is not active" };
  if (game.phase !== "commit_move") return { valid: false, reason: "Not in move phase" };
  if (game.currentTurnPlayer !== playerNum) return { valid: false, reason: "Not your turn" };

  const myPieces = pieces.filter(p => p.player === playerNum);
  const piece = myPieces.find(p => p.pieceIndex === pieceIndex);
  if (!piece) return { valid: false, reason: "Piece not found" };
  if (!piece.isAlive) return { valid: false, reason: "Piece is captured" };

  // Board bounds — all 6 rows always active (exposure doesn't remove rows)
  if (destCol < 0 || destCol > 6) return { valid: false, reason: "Column out of bounds" };
  if (destAbsRow < 0 || destAbsRow > 5) return { valid: false, reason: "Row out of bounds" };

  // Self-collision check
  const otherMyPiece = myPieces.find(p => p.pieceIndex !== pieceIndex);
  if (
    otherMyPiece?.isPlaced &&
    otherMyPiece.col === destCol &&
    otherMyPiece.row === destAbsRow
  ) {
    return { valid: false, reason: "Cannot move to a square occupied by your own piece" };
  }

  if (!piece.isPlaced) {
    // Placement: must be on home row
    if (destAbsRow !== homeRowAbs(playerNum)) {
      return { valid: false, reason: "First move must place piece on your home row (row 1)" };
    }
  } else {
    // Regular king move from current position
    if (!isKingMove(piece.col!, piece.row!, destCol, destAbsRow)) {
      return { valid: false, reason: "Invalid move: pieces move 1 square in any direction (king movement)" };
    }
  }

  return { valid: true };
}

// ─── Turn resolution ──────────────────────────────────────────────────────────

export interface TurnOutcome {
  guessCorrect: boolean;
  guessPassed: boolean;
  pieceCaptured: boolean;
  collision: boolean;
  monsoonTriggered: boolean;
  newExposedRows: number[];
  gameOver: boolean;
  winner: number | null;
  winCondition: string | null;
  events: Array<{ eventType: string; data: Record<string, unknown> }>;
  pieceUpdates: Array<{ id: number; changes: Partial<GamePiece> }>;
  gameUpdates: Partial<Game>;
}

export function resolveTurn(
  game: Game,
  allPieces: GamePiece[]
): TurnOutcome {
  const moverNum = game.currentTurnPlayer!;
  const guesserNum = opponent(moverNum);
  const pieceIndex = game.pendingMovePieceIndex!;
  const destCol = game.pendingMoveCol!;
  const destAbsRow = game.pendingMoveRow!;
  const guessPassed = game.pendingGuessPass ?? false;
  const guessCol = game.pendingGuessCol;
  const guessRow = game.pendingGuessRow;

  const moverPieces = allPieces.filter(p => p.player === moverNum);
  const guesserPieces = allPieces.filter(p => p.player === guesserNum);
  const movingPiece = moverPieces.find(p => p.pieceIndex === pieceIndex)!;
  const isPlacement = !movingPiece.isPlaced;

  const events: TurnOutcome["events"] = [];
  const pieceUpdates: TurnOutcome["pieceUpdates"] = [];

  // ── 1. Did the guesser correctly identify the destination? ──
  const guessCorrect = !guessPassed && guessCol === destCol && guessRow === destAbsRow;

  // ── 2. Always apply the move (piece moves to destination regardless of guess) ──
  //    If guess correct: piece is captured at destination (trap)
  //    If guess wrong / pass: piece survives, gains stride
  const currentExposedRows = parseExposedRows(game.exposedRows);
  const isExposedDest = currentExposedRows.includes(destAbsRow);

  // Stride: +1 per forward move, +1 for surviving a non-pass wrong guess
  const isForwardMove = isPlacement
    ? false
    : (moverNum === 1 ? destAbsRow < movingPiece.row! : destAbsRow > movingPiece.row!);

  const strideFromMove = (!guessCorrect && !isPlacement && isForwardMove) ? 1 : 0;
  const strideFromWrongGuess = (!guessCorrect && !guessPassed && !isPlacement) ? 1 : 0;
  const newStride = (movingPiece.strideCount || 0) + strideFromMove + strideFromWrongGuess;

  // Move the piece to destination
  pieceUpdates.push({
    id: movingPiece.id,
    changes: {
      col: destCol,
      row: destAbsRow,
      isPlaced: true,
      strideCount: newStride,
      // Exposed row means opponent can always see it; also mark visible if captured (cosmetic)
      isVisible: isExposedDest || guessCorrect,
    },
  });

  if (isPlacement) {
    events.push({
      eventType: "piece_placed",
      data: { player: moverNum, pieceIndex, col: destCol, row: destAbsRow },
    });
  } else {
    events.push({
      eventType: "move_success",
      data: {
        player: moverNum,
        pieceIndex,
        col: destCol,
        row: destAbsRow,
        strideCount: newStride,
        message: guessPassed
          ? "Opponent passed"
          : guessCorrect
          ? "Opponent guessed correctly — trapped!"
          : "Opponent guessed wrong",
      },
    });
  }

  // ── 3. Guess correct → capture the mover's piece ──
  if (guessCorrect) {
    pieceUpdates.push({
      id: movingPiece.id,
      changes: { isAlive: false },
    });
    events.push({
      eventType: "guess_correct",
      data: {
        player: guesserNum,
        col: destCol,
        row: destAbsRow,
        message: `Player ${guesserNum} set a trap! Player ${moverNum}'s piece is captured.`,
      },
    });
    events.push({ eventType: "capture", data: { capturedBy: guesserNum, capturedPlayer: moverNum, pieceIndex } });

    return buildOutcome({
      guessCorrect, guessPassed, pieceCaptured: true, collision: false,
      monsoonTriggered: false, newExposedRows: currentExposedRows,
      gameOver: true, winner: guesserNum, winCondition: "capture",
      events, pieceUpdates, gameUpdates: {},
    });
  }

  if (!guessPassed) {
    events.push({ eventType: "guess_wrong", data: { player: guesserNum } });
  } else {
    events.push({ eventType: "pass", data: { player: guesserNum } });
  }

  // ── 4. Check collision: did the mover land on an opponent's piece? ──
  const collidedPiece = guesserPieces.find(
    p => p.isPlaced && p.isAlive && p.col === destCol && p.row === destAbsRow
  );

  if (collidedPiece) {
    // Capture opponent's piece; reveal the mover (now known position)
    pieceUpdates.push({
      id: collidedPiece.id,
      changes: { isAlive: false },
    });
    pieceUpdates.push({
      id: movingPiece.id,
      changes: { isVisible: true },
    });
    events.push({
      eventType: "collision",
      data: {
        player: moverNum,
        pieceIndex,
        col: destCol,
        row: destAbsRow,
        message: `Player ${moverNum} stormed into Player ${guesserNum}'s position — piece captured!`,
      },
    });
    events.push({ eventType: "capture", data: { capturedBy: moverNum, capturedPlayer: guesserNum, pieceIndex: collidedPiece.pieceIndex } });

    return buildOutcome({
      guessCorrect, guessPassed, pieceCaptured: true, collision: true,
      monsoonTriggered: false, newExposedRows: currentExposedRows,
      gameOver: true, winner: moverNum, winCondition: "capture",
      events, pieceUpdates, gameUpdates: {},
    });
  }

  // ── 5. Advance turn ──
  const nextMover = opponent(moverNum);
  let newRound = game.round;
  const roundComplete = nextMover === 1;
  if (roundComplete) newRound = game.round + 1;

  // ── 6. Monsoon check → expose rows ──
  const monsoonThresholds = [4, 8, 12];
  const shouldExpose = roundComplete && monsoonThresholds.includes(newRound - 1);
  let monsoonActuallyTriggered = false;
  let newExposedRows = [...currentExposedRows];

  if (shouldExpose) {
    monsoonActuallyTriggered = true;
    const monsoonsDone = monsoonThresholds.filter(t => t <= newRound - 1).length;
    newExposedRows = computeExposedRows(monsoonsDone);

    // Reveal pieces currently sitting on newly-exposed rows
    const prevExposed = new Set(currentExposedRows);
    const newlyExposed = newExposedRows.filter(r => !prevExposed.has(r));

    for (const piece of allPieces) {
      if (!piece.isPlaced || !piece.isAlive) continue;
      const currentRow = pieceUpdates.find(u => u.id === piece.id)?.changes.row ?? piece.row;
      if (currentRow != null && newlyExposed.includes(currentRow)) {
        const existing = pieceUpdates.find(u => u.id === piece.id);
        if (existing) {
          existing.changes.isVisible = true;
        } else {
          pieceUpdates.push({ id: piece.id, changes: { isVisible: true } });
        }
      }
    }

    events.push({
      eventType: "row_exposed",
      data: {
        exposedRows: newExposedRows,
        newlyExposed,
        message: `The void closes in. Rows ${newlyExposed.map(r => r + 1).join(" & ")} are now exposed.`,
      },
    });
  }

  return buildOutcome({
    guessCorrect, guessPassed, pieceCaptured: false, collision: false,
    monsoonTriggered: monsoonActuallyTriggered,
    newExposedRows,
    gameOver: false, winner: null, winCondition: null,
    events, pieceUpdates,
    gameUpdates: {
      currentTurnPlayer: nextMover,
      phase: "commit_move",
      round: newRound,
      exposedRows: JSON.stringify(newExposedRows),
      pendingMovePieceIndex: null,
      pendingMoveCol: null,
      pendingMoveRow: null,
      pendingGuessPass: null,
      pendingGuessCol: null,
      pendingGuessRow: null,
    },
  });
}

function buildOutcome(params: {
  guessCorrect: boolean;
  guessPassed: boolean;
  pieceCaptured: boolean;
  collision: boolean;
  monsoonTriggered: boolean;
  newExposedRows: number[];
  gameOver: boolean;
  winner: number | null;
  winCondition: string | null;
  events: TurnOutcome["events"];
  pieceUpdates: TurnOutcome["pieceUpdates"];
  gameUpdates: Partial<Game>;
}): TurnOutcome {
  return params;
}

// ─── Build game state response (perspective-aware) ────────────────────────────

export function buildGameState(
  game: Game,
  allPieces: GamePiece[],
  proximityHistory: ProximityReveal[],
  playerToken: string | null
) {
  let yourNumber: number | null = null;
  if (playerToken) {
    if (playerToken === game.player1Token) yourNumber = 1;
    else if (playerToken === game.player2Token) yourNumber = 2;
  }

  const yourName = yourNumber === 1 ? game.player1Name : yourNumber === 2 ? game.player2Name : null;
  const opponentName = yourNumber === 1 ? game.player2Name : yourNumber === 2 ? game.player1Name : null;

  const isYourTurn = game.status === "active" && yourNumber !== null
    ? (game.phase === "commit_move"
      ? game.currentTurnPlayer === yourNumber
      : game.currentTurnPlayer !== yourNumber)
    : false;

  const exposedAbsRows = parseExposedRows(game.exposedRows);

  // Compute exposed rows in perspective coordinates for this player
  const exposedPersRows = yourNumber !== null
    ? exposedAbsRows.map(r => absToPers(r, yourNumber!))
    : exposedAbsRows; // spectators get absolute

  // A piece is visible if it's flagged visible OR its row is exposed
  const isPieceExposed = (p: GamePiece): boolean =>
    p.isPlaced && p.row != null && exposedAbsRows.includes(p.row);

  // Build piece views
  const yourPieces = yourNumber !== null
    ? allPieces.filter(p => p.player === yourNumber).map(p => ({
        index: p.pieceIndex,
        isPlaced: p.isPlaced,
        isAlive: p.isAlive,
        col: p.col ?? null,
        row: p.isPlaced && p.row != null ? absToPers(p.row, yourNumber!) : null,
        strideCount: p.strideCount,
        // isVisible means opponent can see this piece
        isVisible: p.isVisible || isPieceExposed(p),
      }))
    : [];

  const opponentNum = yourNumber !== null ? opponent(yourNumber) : null;
  const opponentPieces = yourNumber !== null
    ? allPieces
        .filter(p => p.player === opponentNum!)
        .map(p => {
          const visible = p.isVisible || isPieceExposed(p);
          return {
            index: p.pieceIndex,
            isPlaced: p.isPlaced,
            isAlive: p.isAlive,
            isVisible: visible,
            col: visible && p.col != null ? p.col : null,
            row: visible && p.row != null ? absToPers(p.row, yourNumber!) : null,
          };
        })
    : [];

  // Proximity history in absolute coords (for the frontend to render)
  const proximity = proximityHistory.map(pr => ({
    round: pr.round,
    col: pr.col,
    row: pr.row,
    result: pr.result as "contact" | "clear",
  }));

  // Monsoon / exposure schedule
  const monsoonsDone = [4, 8, 12].filter(t => t <= game.round - 1).length;
  const nextExposureRound =
    game.round <= 4 ? 4
    : game.round <= 8 ? 8
    : game.round <= 12 ? 12
    : null;

  return {
    id: game.id,
    status: game.status,
    yourNumber,
    yourName: yourName ?? null,
    opponentName: opponentName ?? null,
    currentTurnPlayer: game.currentTurnPlayer,
    phase: game.phase as "commit_move" | "commit_guess" | "finished",
    round: game.round,
    exposedRows: exposedPersRows,
    exposure: {
      exposedRows: exposedPersRows,
      monsoonsDone,
      nextExposureRound,
    },
    yourPieces,
    opponentPieces,
    proximityHistory: proximity,
    moveCommitted: game.phase === "commit_guess",
    isYourTurn,
    winner: game.winner ?? null,
    winCondition: game.winCondition ?? null,
  };
}
