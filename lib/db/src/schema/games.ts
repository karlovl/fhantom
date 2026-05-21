import { pgTable, text, integer, boolean, timestamp, jsonb, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gamesTable = pgTable("games", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("waiting"),
  player1Token: text("player1_token").notNull(),
  player1Name: text("player1_name").notNull(),
  player2Token: text("player2_token"),
  player2Name: text("player2_name"),
  currentTurnPlayer: integer("current_turn_player").notNull().default(1),
  phase: text("phase").notNull().default("commit_move"),
  round: integer("round").notNull().default(1),
  // exposedRows: JSON array of absolute row indices (0-5) that are exposed by monsoon
  exposedRows: text("exposed_rows").notNull().default("[]"),
  winner: integer("winner"),
  winCondition: text("win_condition"),
  pendingMovePieceIndex: integer("pending_move_piece_index"),
  pendingMoveCol: integer("pending_move_col"),
  pendingMoveRow: integer("pending_move_row"),
  pendingGuessPass: boolean("pending_guess_pass"),
  pendingGuessCol: integer("pending_guess_col"),
  pendingGuessRow: integer("pending_guess_row"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertGameSchema = createInsertSchema(gamesTable).omit({ createdAt: true, updatedAt: true });
export type InsertGame = z.infer<typeof insertGameSchema>;
export type Game = typeof gamesTable.$inferSelect;

export const gamePiecesTable = pgTable("game_pieces", {
  id: serial("id").primaryKey(),
  gameId: text("game_id").notNull().references(() => gamesTable.id),
  player: integer("player").notNull(),
  pieceIndex: integer("piece_index").notNull(),
  isPlaced: boolean("is_placed").notNull().default(false),
  isAlive: boolean("is_alive").notNull().default(true),
  col: integer("col"),
  row: integer("row"),
  strideCount: integer("stride_count").notNull().default(0),
  isVisible: boolean("is_visible").notNull().default(false),
});

export type GamePiece = typeof gamePiecesTable.$inferSelect;

export const gameEventsTable = pgTable("game_events", {
  id: serial("id").primaryKey(),
  gameId: text("game_id").notNull().references(() => gamesTable.id),
  seq: integer("seq").notNull(),
  round: integer("round").notNull(),
  eventType: text("event_type").notNull(),
  data: jsonb("data").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GameEvent = typeof gameEventsTable.$inferSelect;

export const proximityRevealsTable = pgTable("proximity_reveals", {
  id: serial("id").primaryKey(),
  gameId: text("game_id").notNull().references(() => gamesTable.id),
  round: integer("round").notNull(),
  col: integer("col").notNull(),
  row: integer("row").notNull(),
  result: text("result").notNull(),
});

export type ProximityReveal = typeof proximityRevealsTable.$inferSelect;
