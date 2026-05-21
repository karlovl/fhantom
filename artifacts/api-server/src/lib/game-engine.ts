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

/** Far side (win destination, absolute) for a player */
export function farSideAbs(player: number): number {
  return player === 1 ? 0 : 5;
}

/** Check if an absolute row is active given current rowsRemaining */
export function isRowActive(absRow: number, rowsRemaining: number): boolean {
  const consumed = (6 - rowsRemaining) / 2;
  return absRow >= consumed && absRow <= 5 - consumed;
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

/** Check if a move is forward (toward opponent's side) */
export function isForwardMove(fromAbsRow: number, toAbsRow: number, player: number): boolean {
  if (player === 1) return toAbsRow < fromAbsRow; // P1 moves toward row 0
  return toAbsRow > fromAbsRow;                   // P2 moves toward row 5
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

  // Board bounds
  if (destCol < 0 || destCol > 6) return { valid: false, reason: "Column out of bounds" };
  if (!isRowActive(destAbsRow, game.rowsRemaining)) {
    return { valid: false, reason: "Row is not active (consumed by monsoon)" };
  }

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
  moveBlocked: boolean;
  guessCorrect: boolean;
  guessPassed: boolean;
  strideGained: boolean;
  collision: boolean;
  monsoonTriggered: boolean;
  proximityReveals: Array<{ col: number; row: number; result: "contact" | "clear" }>;
  displacedPieces: Array<{ player: number; pieceIndex: number }>;
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
  const movingPiece = moverPieces.find(p => p.pieceIndex === pieceIndex)!;
  const isPlacement = !movingPiece.isPlaced;

  const events: TurnOutcome["events"] = [];
  const pieceUpdates: TurnOutcome["pieceUpdates"] = [];

  // ── 1. Did the guess match? ──
  const guessCorrect = !guessPassed && guessCol === destCol && guessRow === destAbsRow;
  const moveBlocked = guessCorrect;

  // ── 2. Apply move or block ──
  if (!moveBlocked) {
    // Move succeeds: update piece position
    const fromCol = movingPiece.col;
    const fromAbsRow = movingPiece.row;
    const isPlacementNow = isPlacement;
    const isForward = isPlacementNow
      ? false
      : isForwardMove(fromAbsRow!, destAbsRow, moverNum);

    // Stride gain: +1 if forward move, +1 if opponent guessed wrong (not a pass)
    const strideFromMove = isForward ? 1 : 0;
    const strideFromWrongGuess = !guessPassed && !guessCorrect ? 1 : 0;
    const strideGain = strideFromMove + strideFromWrongGuess;

    const newStride = (movingPiece.strideCount || 0) + strideGain;

    pieceUpdates.push({
      id: movingPiece.id,
      changes: {
        col: destCol,
        row: destAbsRow,
        isPlaced: true,
        strideCount: newStride,
      },
    });

    if (isPlacementNow) {
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
          message: guessPassed ? "Opponent passed" : "Opponent guessed wrong",
        },
      });
    }

    if (!guessPassed) {
      events.push({ eventType: "guess_wrong", data: { player: guesserNum } });
    } else {
      events.push({ eventType: "pass", data: { player: guesserNum } });
    }

    // ── 3. Check collision: did mover land on opponent's piece? ──
    const guesserPieces = allPieces.filter(p => p.player === guesserNum);
    const collidedPiece = guesserPieces.find(
      p => p.isPlaced && p.isAlive && p.col === destCol && p.row === destAbsRow
    );

    if (collidedPiece) {
      pieceUpdates.push({
        id: collidedPiece.id,
        changes: { isAlive: false },
      });
      // Reveal mover's piece (collision reveals both)
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
          message: `Player ${moverNum} captured Player ${guesserNum}'s piece!`,
        },
      });
    }

    // ── 4. Check crossing win ──
    if (!isPlacementNow && destAbsRow === farSideAbs(moverNum)) {
      events.push({
        eventType: "crossing",
        data: { player: moverNum, pieceIndex, col: destCol, row: destAbsRow },
      });
      return buildOutcome({
        moveBlocked: false, guessCorrect: false, guessPassed,
        strideGained: strideGain > 0, collision: !!collidedPiece,
        monsoonTriggered: false, proximityReveals: [], displacedPieces: [],
        gameOver: true, winner: moverNum, winCondition: "crossing",
        events, pieceUpdates, gameUpdates: {},
      });
    }

    // ── 5. Check stride win ──
    const updatedStride = pieceUpdates.find(u => u.id === movingPiece.id)?.changes.strideCount ?? movingPiece.strideCount;
    if (updatedStride >= 5) {
      events.push({
        eventType: "stride_win",
        data: { player: moverNum, pieceIndex, strideCount: updatedStride },
      });
      return buildOutcome({
        moveBlocked: false, guessCorrect: false, guessPassed,
        strideGained: strideGain > 0, collision: !!collidedPiece,
        monsoonTriggered: false, proximityReveals: [], displacedPieces: [],
        gameOver: true, winner: moverNum, winCondition: "stride",
        events, pieceUpdates, gameUpdates: {},
      });
    }

    // ── 6. Check collision win (opponent lost all pieces) ──
    const guesserAlivePieces = guesserPieces.filter(p => {
      if (!p.isAlive) return false;
      // Check if we just killed it
      const update = pieceUpdates.find(u => u.id === p.id);
      if (update?.changes.isAlive === false) return false;
      return true;
    });
    if (guesserAlivePieces.length === 0) {
      return buildOutcome({
        moveBlocked: false, guessCorrect: false, guessPassed,
        strideGained: strideGain > 0, collision: !!collidedPiece,
        monsoonTriggered: false, proximityReveals: [], displacedPieces: [],
        gameOver: true, winner: moverNum, winCondition: "collision",
        events, pieceUpdates, gameUpdates: {},
      });
    }
  } else {
    // Move blocked
    events.push({
      eventType: "move_blocked",
      data: { player: moverNum, pieceIndex, col: destCol, row: destAbsRow },
    });
    events.push({
      eventType: "guess_correct",
      data: { player: guesserNum, col: destCol, row: destAbsRow },
    });
  }

  // ── 7. Advance turn ──
  const nextMover = opponent(moverNum);
  let newRound = game.round;
  let newRowsRemaining = game.rowsRemaining;
  const monsoonTriggered = false;
  const proximityReveals: TurnOutcome["proximityReveals"] = [];
  const displacedPieces: TurnOutcome["displacedPieces"] = [];

  // Round increments after P2's half-turn (i.e., when we flip back to P1)
  const roundComplete = nextMover === 1;
  if (roundComplete) {
    newRound = game.round + 1;
  }

  // ── 8. Monsoon check ──
  const monsoonThresholds = [4, 8, 12];
  const shouldMonsoon = roundComplete && monsoonThresholds.includes(newRound - 1);

  let monsoonActuallyTriggered = false;
  if (shouldMonsoon && newRowsRemaining > 0) {
    monsoonActuallyTriggered = true;
    newRowsRemaining -= 2;

    events.push({
      eventType: "monsoon",
      data: {
        rowsRemaining: newRowsRemaining,
        message: `Monsoon advances. Board shrinks to ${newRowsRemaining} rows.`,
      },
    });

    // Displace pieces on consumed rows
    const consumed = (6 - newRowsRemaining) / 2;
    const minActiveRow = consumed;
    const maxActiveRow = 5 - consumed;

    // The rows just consumed are the ones at minActiveRow-1 and maxActiveRow+1
    const prevMinActive = consumed - 1;
    const prevMaxActive = 5 - consumed + 1;

    const applyPieceUpdates = pieceUpdates.reduce((acc, u) => {
      acc[u.id] = { ...u.changes };
      return acc;
    }, {} as Record<number, Partial<GamePiece>>);

    for (const piece of allPieces) {
      if (!piece.isPlaced || !piece.isAlive) continue;
      const currentPieceRow = (applyPieceUpdates[piece.id]?.row ?? piece.row)!;

      // Was this piece on a consumed row?
      if (currentPieceRow === prevMinActive || currentPieceRow === prevMaxActive) {
        // Push forward 1 row toward center
        const newPieceRow = currentPieceRow === prevMinActive
          ? minActiveRow   // was on top row, push to new min
          : maxActiveRow;  // was on bottom row, push to new max

        // Reveal the displaced piece
        pieceUpdates.push({
          id: piece.id,
          changes: { row: newPieceRow, isVisible: true },
        });
        displacedPieces.push({ player: piece.player, pieceIndex: piece.pieceIndex });
        events.push({
          eventType: "displacement",
          data: {
            player: piece.player,
            pieceIndex: piece.pieceIndex,
            col: piece.col,
            row: newPieceRow,
            message: `Piece displaced by monsoon to row ${newPieceRow}`,
          },
        });
      }
    }

    // Proximity reveal: pick a random active square, check if any opponent piece is within 1 square
    // Do this twice — one for each player's benefit (simplified: one reveal total)
    if (newRowsRemaining > 0) {
      const revealResult = generateProximityReveal(allPieces, pieceUpdates, newRowsRemaining);
      if (revealResult) {
        proximityReveals.push(revealResult);
        events.push({
          eventType: "proximity_reveal",
          data: {
            col: revealResult.col,
            row: revealResult.row,
            proximityResult: revealResult.result,
            message: `Proximity reveal at (${String.fromCharCode(65 + revealResult.col)}${revealResult.row + 1}): ${revealResult.result.toUpperCase()}`,
          },
        });
      }
    }

    // Check monsoon timeout game end
    if (newRowsRemaining === 0) {
      // Determine winner by highest stride
      const allUpdatedPieces = allPieces.map(p => {
        const updates = pieceUpdates.filter(u => u.id === p.id);
        let updated = { ...p };
        for (const u of updates) updated = { ...updated, ...u.changes };
        return updated;
      });
      const p1MaxStride = Math.max(
        ...allUpdatedPieces.filter(p => p.player === 1 && p.isAlive).map(p => p.strideCount),
        -1
      );
      const p2MaxStride = Math.max(
        ...allUpdatedPieces.filter(p => p.player === 2 && p.isAlive).map(p => p.strideCount),
        -1
      );
      const p1Alive = allUpdatedPieces.filter(p => p.player === 1 && p.isAlive).length;
      const p2Alive = allUpdatedPieces.filter(p => p.player === 2 && p.isAlive).length;

      let monsoonWinner: number | null = null;
      let monsoonCondition = "monsoon";
      if (p1MaxStride > p2MaxStride) monsoonWinner = 1;
      else if (p2MaxStride > p1MaxStride) monsoonWinner = 2;
      else if (p1Alive > p2Alive) monsoonWinner = 1;
      else if (p2Alive > p1Alive) monsoonWinner = 2;
      // else draw

      return buildOutcome({
        moveBlocked, guessCorrect, guessPassed,
        strideGained: false, collision: false,
        monsoonTriggered: true, proximityReveals, displacedPieces,
        gameOver: true, winner: monsoonWinner, winCondition: monsoonCondition,
        events, pieceUpdates, gameUpdates: { round: newRound, rowsRemaining: newRowsRemaining },
      });
    }
  }

  return buildOutcome({
    moveBlocked, guessCorrect, guessPassed,
    strideGained: !moveBlocked && !guessPassed && !guessCorrect,
    collision: false,
    monsoonTriggered: monsoonActuallyTriggered,
    proximityReveals, displacedPieces,
    gameOver: false, winner: null, winCondition: null,
    events, pieceUpdates,
    gameUpdates: {
      currentTurnPlayer: nextMover,
      phase: "commit_move",
      round: newRound,
      rowsRemaining: newRowsRemaining,
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
  moveBlocked: boolean;
  guessCorrect: boolean;
  guessPassed: boolean;
  strideGained: boolean;
  collision: boolean;
  monsoonTriggered: boolean;
  proximityReveals: TurnOutcome["proximityReveals"];
  displacedPieces: TurnOutcome["displacedPieces"];
  gameOver: boolean;
  winner: number | null;
  winCondition: string | null;
  events: TurnOutcome["events"];
  pieceUpdates: TurnOutcome["pieceUpdates"];
  gameUpdates: Partial<Game>;
}): TurnOutcome {
  return params;
}

function generateProximityReveal(
  allPieces: GamePiece[],
  pieceUpdates: TurnOutcome["pieceUpdates"],
  rowsRemaining: number
): { col: number; row: number; result: "contact" | "clear" } | null {
  const consumed = (6 - rowsRemaining) / 2;
  const minRow = consumed;
  const maxRow = 5 - consumed;

  // Pick a random active square
  const col = Math.floor(Math.random() * 7);
  const row = minRow + Math.floor(Math.random() * (maxRow - minRow + 1));

  // Get updated positions
  const updatedPieces = allPieces.map(p => {
    const updates = pieceUpdates.filter(u => u.id === p.id);
    let updated = { ...p };
    for (const u of updates) updated = { ...updated, ...u.changes };
    return updated;
  });

  // Check if any piece is within 1 square (king distance)
  const hasContact = updatedPieces.some(p => {
    if (!p.isPlaced || !p.isAlive) return false;
    return Math.abs((p.col ?? -99) - col) <= 1 && Math.abs((p.row ?? -99) - row) <= 1;
  });

  return { col, row, result: hasContact ? "contact" : "clear" };
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
      : game.currentTurnPlayer !== yourNumber) // commit_guess: guesser's turn
    : false;

  // Build piece views
  const yourPieces = yourNumber !== null
    ? allPieces.filter(p => p.player === yourNumber).map(p => ({
        index: p.pieceIndex,
        isPlaced: p.isPlaced,
        isAlive: p.isAlive,
        col: p.col ?? null,
        row: p.isPlaced && p.row != null ? absToPers(p.row, yourNumber!) : null,
        strideCount: p.strideCount,
        isVisible: p.isVisible,
      }))
    : [];

  const opponentPieces = yourNumber !== null
    ? allPieces
        .filter(p => p.player === opponent(yourNumber!))
        .map(p => ({
          index: p.pieceIndex,
          isPlaced: p.isPlaced,
          isAlive: p.isAlive,
          isVisible: p.isVisible,
          col: p.isVisible && p.col != null ? p.col : null,
          row: p.isVisible && p.row != null ? absToPers(p.row, yourNumber!) : null,
        }))
    : [];

  // Proximity history: convert rows to absolute (as stored)
  const proximity = proximityHistory.map(pr => ({
    round: pr.round,
    col: pr.col,
    row: pr.row,
    result: pr.result as "contact" | "clear",
  }));

  return {
    id: game.id,
    status: game.status,
    yourNumber,
    yourName: yourName ?? null,
    opponentName: opponentName ?? null,
    currentTurnPlayer: game.currentTurnPlayer,
    phase: game.phase as "commit_move" | "commit_guess" | "finished",
    round: game.round,
    rowsRemaining: game.rowsRemaining,
    monsoon: {
      rowsRemaining: game.rowsRemaining,
      nextMonsoonRound: game.round <= 4 ? 4 : game.round <= 8 ? 8 : 12,
      currentRound: game.round,
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
