export * from "./generated/api";

// Re-export TS types individually (excluding getGameParams — its type name conflicts
// with the identically-named Zod schema already exported from ./generated/api above)
export * from "./generated/types/actionResult";
export * from "./generated/types/createGameInput";
export * from "./generated/types/exposureStatus";
export * from "./generated/types/gameEvent";
export * from "./generated/types/gameEventData";
export * from "./generated/types/gameEventEventType";
export * from "./generated/types/gameJoinResult";
export * from "./generated/types/gameJoinResultPlayerNumber";
export * from "./generated/types/gameState";
export * from "./generated/types/gameStatePhase";
export * from "./generated/types/gameStateStatus";
export * from "./generated/types/gameStateWinCondition";
export * from "./generated/types/gameSummary";
export * from "./generated/types/gameSummaryStatus";
// getGameParams skipped — GetGameParams name already exported as Zod schema from ./generated/api
export * from "./generated/types/guessInput";
export * from "./generated/types/healthStatus";
export * from "./generated/types/joinGameInput";
export * from "./generated/types/moveInput";
export * from "./generated/types/moveInputPieceIndex";
export * from "./generated/types/opponentPieceState";
export * from "./generated/types/opponentPieceStateIndex";
export * from "./generated/types/pieceState";
export * from "./generated/types/pieceStateIndex";
export * from "./generated/types/proximityReveal";
export * from "./generated/types/proximityRevealResult";
export * from "./generated/types/turnOutcome";
export * from "./generated/types/turnOutcomeWinCondition";
export * from "./generated/types/turnResult";
