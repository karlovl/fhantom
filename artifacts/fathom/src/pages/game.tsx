import { useParams, useLocation, Link } from "wouter";
import { useEffect, useState } from "react";
import {
  useGetGame,
  useGetGameEvents,
  useSubmitMove,
  useSubmitGuess,
  useForfeitGame,
  getGetGameQueryKey,
  getGetGameEventsQueryKey,
  MoveInputPieceIndex,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

const COLS = [0, 1, 2, 3, 4, 5, 6];
const ROWS = [6, 5, 4, 3, 2, 1]; // top → bottom on screen (opponent home → your home)
const COL_LABELS = ["A", "B", "C", "D", "E", "F", "G"];

export default function Game() {
  const params = useParams();
  const gameId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const token = localStorage.getItem(`fathom-token-${gameId}`) || "";

  const { data: game, isLoading, isError } = useGetGame(gameId!, undefined, {
    query: { queryKey: getGetGameQueryKey(gameId!), refetchInterval: 2000, enabled: !!gameId },
    request: { headers: { "X-Player-Token": token } },
  });

  const { data: events } = useGetGameEvents(gameId!, {
    query: { queryKey: getGetGameEventsQueryKey(gameId!), refetchInterval: 2000, enabled: !!gameId },
    request: { headers: { "X-Player-Token": token } },
  });

  const submitMove = useSubmitMove({ request: { headers: { "X-Player-Token": token } } });
  const submitGuess = useSubmitGuess({ request: { headers: { "X-Player-Token": token } } });
  const forfeitGame = useForfeitGame({ request: { headers: { "X-Player-Token": token } } });

  const [selectedPieceIndex, setSelectedPieceIndex] = useState<number | null>(null);
  const [selectedMoveSquare, setSelectedMoveSquare] = useState<{ col: number; row: number } | null>(null);
  const [selectedGuessSquare, setSelectedGuessSquare] = useState<{ col: number; row: number } | null>(null);
  // Lock controls immediately on submit to prevent double-submission during refetch window
  const [moveSubmitted, setMoveSubmitted] = useState(false);
  const [guessSubmitted, setGuessSubmitted] = useState(false);

  useEffect(() => {
    setSelectedPieceIndex(null);
    setSelectedMoveSquare(null);
    setSelectedGuessSquare(null);
    setMoveSubmitted(false);
    setGuessSubmitted(false);
  }, [game?.phase, game?.round]);

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-4">
        <h1 className="text-xl text-destructive font-mono uppercase">Signal Lost</h1>
        <Button onClick={() => setLocation("/")} variant="outline">Return to Base</Button>
      </div>
    );
  }

  if (isLoading || !game) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary font-mono animate-pulse glow-text-cyan">Establishing Connection...</div>
      </div>
    );
  }

  const isMover = game.yourNumber !== null && game.currentTurnPlayer === game.yourNumber;
  const isGuesser = game.yourNumber !== null && game.currentTurnPlayer !== null && game.currentTurnPlayer !== game.yourNumber;
  // moveSubmitted/guessSubmitted lock controls immediately after submit while refetch is in-flight,
  // preventing the double-submission race that makes the guesser appear to "miss their turn"
  const canMove = isMover && game.phase === "commit_move" && !game.moveCommitted && !moveSubmitted;
  const canGuess = isGuesser && game.phase === "commit_guess" && !guessSubmitted;

  const exposedRows: number[] = game.exposedRows ?? [];

  const handleSquareClick = (col: number, row: number) => {
    if (canMove && selectedPieceIndex !== null) {
      const piece = game.yourPieces.find(p => p.index === selectedPieceIndex);
      if (!piece) return;
      if (!piece.isPlaced) {
        if (row === 1) setSelectedMoveSquare({ col, row });
        return;
      }
      if (piece.col !== null && piece.row !== null) {
        const dCol = Math.abs(col - piece.col);
        const dRow = Math.abs(row - piece.row);
        if (dCol <= 1 && dRow <= 1 && !(dCol === 0 && dRow === 0)) {
          setSelectedMoveSquare({ col, row });
        }
      }
    } else if (canGuess) {
      setSelectedGuessSquare({ col, row });
    }
  };

  const handleConfirmMove = () => {
    if (selectedPieceIndex === null || !selectedMoveSquare) return;
    setMoveSubmitted(true); // lock immediately — prevent double-submission during refetch window
    submitMove.mutate(
      { id: gameId!, data: { pieceIndex: selectedPieceIndex as MoveInputPieceIndex, col: selectedMoveSquare.col, row: selectedMoveSquare.row } },
      {
        onSuccess: () => {
          toast({ title: "Move committed to the void" });
          queryClient.invalidateQueries({ queryKey: getGetGameQueryKey(gameId!) });
        },
        onError: () => {
          setMoveSubmitted(false); // unlock on error so player can retry
          toast({ title: "Move blocked", variant: "destructive" });
        },
      }
    );
  };

  const handleConfirmGuess = () => {
    if (!selectedGuessSquare) return;
    setGuessSubmitted(true); // lock immediately
    submitGuess.mutate(
      { id: gameId!, data: { pass: false, col: selectedGuessSquare.col, row: selectedGuessSquare.row } },
      {
        onSuccess: (data) => {
          const captured = data.outcome.pieceCaptured;
          const correct = data.outcome.guessCorrect;
          const msg = captured
            ? correct ? "Trap sprung — piece captured!" : "Collision — piece captured!"
            : "Wrong — they slipped through";
          toast({ title: msg, variant: captured ? "default" : "destructive" });
          queryClient.invalidateQueries({ queryKey: getGetGameQueryKey(gameId!) });
          queryClient.invalidateQueries({ queryKey: getGetGameEventsQueryKey(gameId!) });
        },
        onError: () => {
          setGuessSubmitted(false); // unlock on error
          toast({ title: "Guess failed", variant: "destructive" });
        },
      }
    );
  };

  const handlePassGuess = () => {
    setGuessSubmitted(true); // lock immediately
    submitGuess.mutate(
      { id: gameId!, data: { pass: true } },
      {
        onSuccess: () => {
          toast({ title: "Turn passed" });
          queryClient.invalidateQueries({ queryKey: getGetGameQueryKey(gameId!) });
          queryClient.invalidateQueries({ queryKey: getGetGameEventsQueryKey(gameId!) });
        },
        onError: () => {
          setGuessSubmitted(false);
          toast({ title: "Pass failed", variant: "destructive" });
        },
      }
    );
  };

  const handleForfeit = () => {
    if (!confirm("Forfeit this game?")) return;
    forfeitGame.mutate(
      { id: gameId! },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetGameQueryKey(gameId!) });
        },
      }
    );
  };

  const monsoonsDone = game.exposure?.monsoonsDone ?? 0;
  const nextExposureRound = game.exposure?.nextExposureRound ?? null;

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground flex flex-col md:flex-row">

      {/* ── Board area ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-6">

        {/* Status bar */}
        <div className="w-full max-w-2xl flex justify-between items-end border-b border-border pb-4">
          <div>
            <div className="text-muted-foreground text-xs uppercase tracking-widest mb-1">Status</div>
            <div className="text-xl font-mono text-primary uppercase">
              {game.status === "waiting" && "Waiting for opponent..."}
              {game.status === "active" && canMove && "Your turn — commit a move"}
              {game.status === "active" && canGuess && "Set your trap — guess or pass"}
              {game.status === "active" && !canMove && !canGuess && "Opponent is moving..."}
              {game.status === "finished" && (
                game.winner === game.yourNumber ? "Victory — capture secured" : "Defeat — piece lost"
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href={`/spectate/${gameId}`}
              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-primary border border-border hover:border-primary/50 px-2 py-1 rounded transition-colors"
            >
              Spectate
            </Link>
            <div className="text-right">
              <div className="text-muted-foreground text-xs uppercase tracking-widest mb-1">Round</div>
              <div className="text-2xl font-mono text-primary">{game.round}</div>
            </div>
          </div>
        </div>

        {/* Invite panel — shown while waiting for P2 to join */}
        {game.status === "waiting" && (
          <div className="w-full max-w-2xl p-4 bg-card border border-primary/30 rounded-lg space-y-2">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Invite your opponent</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-primary bg-background border border-border rounded px-3 py-2 truncate">
                {gameId}
              </code>
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-xs shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(gameId ?? "").then(() =>
                    toast({ title: "Game ID copied" })
                  );
                }}
              >
                Copy ID
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="font-mono text-xs shrink-0"
                onClick={() => {
                  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                  const url = `${window.location.origin}${base}/game/${gameId}`;
                  navigator.clipboard.writeText(url).then(() =>
                    toast({ title: "Invite link copied" })
                  );
                }}
              >
                Copy Link
              </Button>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              Share this ID (or the "Copy Link" URL) so your opponent can join from the lobby.
            </div>
          </div>
        )}

        {/* Opponent label */}
        <div className="w-full max-w-2xl text-center text-xs font-mono text-muted-foreground uppercase tracking-widest">
          {game.opponentName ?? "Opponent"} ▲
        </div>

        {/* Board */}
        <div className="relative max-w-2xl w-full select-none">
          <div className="grid grid-cols-[auto_repeat(7,1fr)_auto] gap-1">

            {/* Top column labels */}
            <div />
            {COL_LABELS.map(c => (
              <div key={c} className="text-center text-xs font-mono text-muted-foreground pb-1">{c}</div>
            ))}
            <div />

            {ROWS.map(row => {
              const isExposed = exposedRows.includes(row);
              return (
                <div key={row} className="contents">
                  <div className="flex items-center justify-end pr-2 text-xs font-mono text-muted-foreground">{row}</div>

                  {COLS.map(col => {
                    const yourPiece = game.yourPieces.find(
                      p => p.col === col && p.row === row && p.isPlaced && p.isAlive
                    );
                    const opponentPiece = game.opponentPieces.find(
                      p => p.col === col && p.row === row && p.isVisible && p.isAlive
                    );
                    const isSelectedPiece =
                      selectedPieceIndex !== null &&
                      game.yourPieces.find(p => p.index === selectedPieceIndex)?.col === col &&
                      game.yourPieces.find(p => p.index === selectedPieceIndex)?.row === row;
                    const isMoveDest = selectedMoveSquare?.col === col && selectedMoveSquare?.row === row;
                    const isGuessDest = selectedGuessSquare?.col === col && selectedGuessSquare?.row === row;

                    // Possible move highlight
                    let isPossibleMove = false;
                    if (canMove && selectedPieceIndex !== null) {
                      const piece = game.yourPieces.find(p => p.index === selectedPieceIndex);
                      if (piece) {
                        if (!piece.isPlaced && row === 1) isPossibleMove = true;
                        else if (piece.isPlaced && piece.col !== null && piece.row !== null) {
                          const dc = Math.abs(piece.col - col);
                          const dr = Math.abs(piece.row - row);
                          if (dc <= 1 && dr <= 1 && (dc + dr > 0)) isPossibleMove = true;
                        }
                      }
                    }

                    return (
                      <div
                        key={`${col}-${row}`}
                        onClick={() => handleSquareClick(col, row)}
                        className={[
                          "aspect-square border flex items-center justify-center relative transition-all duration-300",
                          isExposed
                            ? "bg-amber-950/40 border-amber-600/60 shadow-[inset_0_0_8px_rgba(217,119,6,0.15)]"
                            : "bg-card border-white/10 hover:border-primary/40",
                          isMoveDest || isGuessDest
                            ? "!bg-primary/20 !border-primary shadow-[0_0_15px_rgba(0,255,255,0.3)]"
                            : "",
                          isSelectedPiece ? "!border-primary shadow-[0_0_15px_rgba(0,255,255,0.5)]" : "",
                          // Pointer only when the click will actually do something
                          (isPossibleMove || isGuessDest || (canGuess && !isGuessDest))
                            ? "cursor-pointer"
                            : "cursor-default",
                        ].join(" ")}
                      >
                        {/* Possible move dot */}
                        {isPossibleMove && !yourPiece && (
                          <div className="absolute w-2 h-2 bg-primary/50 rounded-full" />
                        )}

                        {/* Your piece */}
                        {yourPiece && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (canMove) {
                                setSelectedPieceIndex(yourPiece.index);
                                setSelectedMoveSquare(null);
                              }
                            }}
                            className={[
                              "w-4/5 h-4/5 rounded-sm border flex items-center justify-center font-mono font-bold text-xs transition-all",
                              // exposed = opponent can see us, flash amber border
                              yourPiece.isVisible
                                ? "bg-amber-500/30 border-amber-400 text-amber-200"
                                : "bg-primary/80 border-primary text-primary-foreground",
                              isSelectedPiece ? "ring-2 ring-white ring-offset-1 ring-offset-transparent" : "",
                            ].join(" ")}
                            title={yourPiece.isVisible ? "EXPOSED — opponent can see you" : "Hidden"}
                          >
                            {yourPiece.strideCount > 0 ? yourPiece.strideCount : "◆"}
                          </button>
                        )}

                        {/* Opponent piece (only if visible) */}
                        {opponentPiece && (
                          <div className="w-4/5 h-4/5 rounded-sm bg-destructive/80 border border-destructive flex items-center justify-center text-destructive-foreground font-mono text-xs shadow-[0_0_12px_rgba(239,68,68,0.5)]">
                            ✕
                          </div>
                        )}

                        {/* Exposed row shimmer overlay */}
                        {isExposed && (
                          <div className="absolute inset-0 pointer-events-none border border-amber-500/20 rounded-[1px]" />
                        )}
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-start pl-2 text-xs font-mono text-muted-foreground">{row}</div>
                </div>
              );
            })}

            {/* Bottom column labels */}
            <div />
            {COL_LABELS.map(c => (
              <div key={c} className="text-center text-xs font-mono text-muted-foreground pt-1">{c}</div>
            ))}
            <div />
          </div>
        </div>

        {/* Your name label */}
        <div className="w-full max-w-2xl text-center text-xs font-mono text-muted-foreground uppercase tracking-widest">
          ▼ {game.yourName ?? "You"}
        </div>

        {/* Action controls */}
        {game.status === "active" && (
          <div className="w-full max-w-2xl p-5 bg-card border border-border rounded-lg flex flex-col md:flex-row items-center gap-4">

            {canMove && (
              <>
                <div className="flex gap-2 flex-shrink-0">
                  {game.yourPieces.filter(p => p.isAlive).map(piece => (
                    <Button
                      key={piece.index}
                      variant={selectedPieceIndex === piece.index ? "default" : "outline"}
                      className="font-mono text-xs"
                      onClick={() => { setSelectedPieceIndex(piece.index); setSelectedMoveSquare(null); }}
                    >
                      {piece.isPlaced ? `Piece ${piece.index + 1}` : `Deploy ${piece.index + 1}`}
                    </Button>
                  ))}
                </div>
                <div className="text-xs font-mono text-muted-foreground flex-1">
                  {selectedPieceIndex === null
                    ? "← Select a piece first"
                    : selectedMoveSquare
                    ? `→ ${COL_LABELS[selectedMoveSquare.col]}${selectedMoveSquare.row}`
                    : "Click a highlighted square"}
                </div>
                <Button
                  onClick={handleConfirmMove}
                  disabled={!selectedMoveSquare || submitMove.isPending}
                  className="ml-auto font-mono uppercase tracking-wider text-xs"
                >
                  {submitMove.isPending ? "Transmitting..." : "Commit Move"}
                </Button>
              </>
            )}

            {canGuess && (
              <>
                <div className="text-xs font-mono text-muted-foreground flex-1">
                  {selectedGuessSquare
                    ? `Targeting ${COL_LABELS[selectedGuessSquare.col]}${selectedGuessSquare.row} — confirm or pick another`
                    : "Click a square to set your trap"}
                </div>
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" onClick={handlePassGuess} disabled={submitGuess.isPending} className="font-mono text-xs">
                    Pass
                  </Button>
                  <Button
                    onClick={handleConfirmGuess}
                    disabled={!selectedGuessSquare || submitGuess.isPending}
                    className="font-mono uppercase tracking-wider text-xs"
                  >
                    {submitGuess.isPending ? "Springing..." : "Commit Guess"}
                  </Button>
                </div>
              </>
            )}

            {!canMove && !canGuess && (
              <div className="text-xs font-mono text-muted-foreground animate-pulse text-center w-full">
                {game.phase === "commit_move"
                  ? "Opponent is plotting in the dark..."
                  : "Opponent is setting their trap..."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sidebar ── */}
      <div className="w-full md:w-72 bg-card/50 border-t md:border-t-0 md:border-l border-border flex flex-col p-5 h-[40vh] md:h-screen gap-5">

        {/* Exposure / Monsoon panel */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Void Pressure</h3>
          <div className="bg-background border border-border rounded p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono text-muted-foreground">Monsoons</span>
              <div className="flex gap-1">
                {[1, 2, 3].map(k => (
                  <div
                    key={k}
                    className={`w-3 h-3 rounded-sm border ${
                      k <= monsoonsDone
                        ? "bg-amber-500 border-amber-400"
                        : "border-white/20 bg-transparent"
                    }`}
                  />
                ))}
              </div>
            </div>
            {nextExposureRound !== null ? (
              <div className="text-center">
                {nextExposureRound - game.round <= 0 ? (
                  <div className="text-xs font-mono text-amber-300 uppercase tracking-wide">Triggering this round!</div>
                ) : (
                  <>
                    <div className="text-2xl font-mono text-amber-400">{nextExposureRound - game.round}</div>
                    <div className="text-[10px] text-muted-foreground font-mono uppercase">rounds until exposure</div>
                  </>
                )}
              </div>
            ) : (
              <div className="text-center text-xs font-mono text-amber-400">All rows exposed</div>
            )}
            {exposedRows.length > 0 && (
              <div className="text-[10px] font-mono text-amber-400/80">
                Exposed: rows {exposedRows.sort((a, b) => a - b).join(", ")}
              </div>
            )}
          </div>
        </div>

        {/* Piece status */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Pieces</h3>
          <div className="space-y-2">
            {game.yourPieces.map(p => (
              <div key={p.index} className="flex items-center justify-between text-xs font-mono bg-background border border-border rounded px-3 py-2">
                <span className={p.isAlive ? "text-primary" : "text-muted-foreground line-through"}>
                  Your {p.index + 1}
                </span>
                <span className={p.isAlive ? "text-muted-foreground" : "text-destructive"}>
                  {!p.isAlive ? "CAPTURED" : p.isPlaced ? `stride ${p.strideCount}` : "undeployed"}
                </span>
                {p.isAlive && p.isVisible && (
                  <span className="text-amber-400 text-[9px]">EXPOSED</span>
                )}
              </div>
            ))}
            {game.opponentPieces.map(p => (
              <div key={p.index} className="flex items-center justify-between text-xs font-mono bg-background border border-border rounded px-3 py-2">
                <span className={p.isAlive ? "text-destructive/80" : "text-muted-foreground line-through"}>
                  Opp {p.index + 1}
                </span>
                <span className={p.isAlive ? "text-muted-foreground" : "text-destructive"}>
                  {!p.isAlive ? "CAPTURED" : p.isVisible ? `${COL_LABELS[p.col!]}${p.row}` : "unknown"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Event log */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Event Log</h3>
          <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[10px]">
            {events?.slice().reverse().map(ev => (
              <div
                key={ev.seq}
                className={`p-2 bg-background border rounded border-l-2 ${
                  ev.eventType === "capture"
                    ? "border-l-destructive"
                    : ev.eventType === "row_exposed"
                    ? "border-l-amber-500"
                    : ev.eventType === "guess_correct"
                    ? "border-l-primary"
                    : "border-l-white/20"
                }`}
              >
                <div className="text-[9px] text-muted-foreground mb-0.5">R{ev.round}</div>
                <div className="text-foreground/80 leading-tight">
                  {(ev.data as Record<string, unknown>).message as string || ev.eventType.replace(/_/g, " ")}
                </div>
              </div>
            ))}
            {(!events || events.length === 0) && (
              <div className="text-muted-foreground text-center p-4 italic text-xs">No events recorded.</div>
            )}
          </div>
        </div>

        {/* Forfeit */}
        <div className="pt-4 border-t border-border">
          <Button
            variant="destructive"
            onClick={handleForfeit}
            className="w-full font-mono text-xs uppercase"
            disabled={game.status === "finished"}
          >
            Forfeit Game
          </Button>
        </div>
      </div>
    </div>
  );
}
