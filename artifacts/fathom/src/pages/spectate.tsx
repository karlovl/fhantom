import { useParams, useLocation } from "wouter";
import { useGetGame, getGetGameQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const COLS = [0, 1, 2, 3, 4, 5, 6];
const ROWS = [6, 5, 4, 3, 2, 1];
const COL_LABELS = ["A", "B", "C", "D", "E", "F", "G"];

export default function Spectate() {
  const params = useParams();
  const gameId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: game, isLoading, isError } = useGetGame(
    gameId!,
    { spectate: true },
    {
      query: {
        queryKey: [...getGetGameQueryKey(gameId!), "spectate"],
        refetchInterval: 2500,
        enabled: !!gameId,
      },
    }
  );

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Spectator link copied" });
    });
  };

  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-xl text-destructive font-mono uppercase">Game Not Found</h1>
        <Button onClick={() => setLocation("/")} variant="outline">Return to Lobby</Button>
      </div>
    );
  }

  if (isLoading || !game) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary font-mono animate-pulse">Tuning into the void...</div>
      </div>
    );
  }

  const exposedRows: number[] = game.exposedRows ?? [];
  const monsoonsDone = game.exposure?.monsoonsDone ?? 0;
  const nextExposureRound = game.exposure?.nextExposureRound ?? null;

  // Spectate view: yourPieces = P1 pieces, opponentPieces = P2 pieces (all revealed, P1 perspective)
  const p1Name = game.yourName ?? "Player 1";
  const p2Name = game.opponentName ?? "Player 2";

  const getPhaseLabel = () => {
    if (game.status === "waiting") return "Waiting for Player 2...";
    if (game.status === "finished") {
      const winnerName = game.winner === 1 ? p1Name : p2Name;
      return `${winnerName} wins by ${game.winCondition ?? "capture"}`;
    }
    const moverName = game.currentTurnPlayer === 1 ? p1Name : p2Name;
    if (game.phase === "commit_move") return `${moverName} is plotting their move...`;
    return `${game.currentTurnPlayer === 1 ? p2Name : p1Name} is setting their trap...`;
  };

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground flex flex-col md:flex-row">

      {/* ── Board ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-6">

        {/* Header */}
        <div className="w-full max-w-2xl flex justify-between items-end border-b border-border pb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40">
                SPECTATING
              </span>
              <span className="text-muted-foreground text-xs font-mono">{p1Name} vs {p2Name}</span>
            </div>
            <div className="text-sm font-mono text-primary">{getPhaseLabel()}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-muted-foreground text-[10px] uppercase tracking-widest">Round</div>
              <div className="text-xl font-mono text-primary">{game.round}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="font-mono text-xs"
            >
              Copy Link
            </Button>
          </div>
        </div>

        {/* P2 label (top of board in P1 perspective) */}
        <div className="w-full max-w-2xl text-center text-xs font-mono uppercase tracking-widest">
          <span className="text-destructive/80">{p2Name}</span>
          <span className="text-muted-foreground"> ▲ (row 6)</span>
        </div>

        {/* Board */}
        <div className="relative max-w-2xl w-full select-none">
          <div className="grid grid-cols-[auto_repeat(7,1fr)_auto] gap-1">

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
                    // yourPieces = P1, opponentPieces = P2 (all revealed, P1 perspective)
                    const p1Piece = game.yourPieces.find(
                      p => p.col === col && p.row === row && p.isPlaced && p.isAlive
                    );
                    const p2Piece = game.opponentPieces.find(
                      p => p.col === col && p.row === row && p.isAlive
                    );
                    const p1Dead = game.yourPieces.find(p => p.col === col && p.row === row && !p.isAlive);
                    const p2Dead = game.opponentPieces.find(p => p.col === col && p.row === row && !p.isAlive);

                    return (
                      <div
                        key={`${col}-${row}`}
                        className={[
                          "aspect-square border flex items-center justify-center relative transition-all duration-300",
                          isExposed
                            ? "bg-amber-950/40 border-amber-600/60 shadow-[inset_0_0_8px_rgba(217,119,6,0.15)]"
                            : "bg-card border-white/10",
                        ].join(" ")}
                      >
                        {/* P1 piece — cyan */}
                        {p1Piece && (
                          <div
                            className="w-4/5 h-4/5 rounded-sm bg-primary/80 border border-primary flex items-center justify-center font-mono font-bold text-xs text-primary-foreground shadow-[0_0_10px_rgba(0,255,255,0.4)]"
                            title={`${p1Name} piece ${p1Piece.index + 1} · stride ${p1Piece.strideCount}`}
                          >
                            {p1Piece.strideCount > 0 ? p1Piece.strideCount : "◆"}
                          </div>
                        )}

                        {/* P2 piece — red */}
                        {p2Piece && (
                          <div
                            className="w-4/5 h-4/5 rounded-sm bg-destructive/80 border border-destructive flex items-center justify-center font-mono font-bold text-xs text-destructive-foreground shadow-[0_0_10px_rgba(239,68,68,0.4)]"
                            title={`${p2Name} piece ${p2Piece.index + 1}`}
                          >
                            ✕
                          </div>
                        )}

                        {/* Ghost — dead piece position */}
                        {(p1Dead || p2Dead) && !p1Piece && !p2Piece && (
                          <div className="w-3 h-3 rounded-full border border-white/20 bg-white/5" title="Piece captured here" />
                        )}

                        {/* Exposed shimmer */}
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

            <div />
            {COL_LABELS.map(c => (
              <div key={c} className="text-center text-xs font-mono text-muted-foreground pt-1">{c}</div>
            ))}
            <div />
          </div>
        </div>

        {/* P1 label */}
        <div className="w-full max-w-2xl text-center text-xs font-mono uppercase tracking-widest">
          <span className="text-muted-foreground">(row 1) ▼ </span>
          <span className="text-primary">{p1Name}</span>
        </div>

        {/* Legend */}
        <div className="flex gap-6 text-[10px] font-mono text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-sm bg-primary/80 border border-primary" />
            <span>{p1Name}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-sm bg-destructive/80 border border-destructive" />
            <span>{p2Name}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-amber-950/60 border border-amber-600/60" />
            <span>Exposed row</span>
          </div>
        </div>

        <Button variant="outline" onClick={() => setLocation("/")} className="font-mono text-xs">
          ← Back to Lobby
        </Button>
      </div>

      {/* ── Sidebar ── */}
      <div className="w-full md:w-64 bg-card/50 border-t md:border-t-0 md:border-l border-border flex flex-col p-5 h-[40vh] md:h-screen gap-5">

        {/* Piece status */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Pieces</h3>
          <div className="space-y-1">
            {game.yourPieces.map(p => (
              <div key={p.index} className="flex items-center justify-between text-xs font-mono bg-background border border-border rounded px-3 py-2">
                <span className={`${p.isAlive ? "text-primary" : "text-muted-foreground line-through"}`}>
                  {p1Name.slice(0, 8)} {p.index + 1}
                </span>
                <span className="text-muted-foreground text-[10px]">
                  {!p.isAlive ? "CAPTURED" : p.isPlaced ? `${COL_LABELS[p.col!]}${p.row} · s${p.strideCount}` : "undeployed"}
                </span>
              </div>
            ))}
            {game.opponentPieces.map(p => (
              <div key={p.index} className="flex items-center justify-between text-xs font-mono bg-background border border-border rounded px-3 py-2">
                <span className={`${p.isAlive ? "text-destructive/80" : "text-muted-foreground line-through"}`}>
                  {p2Name.slice(0, 8)} {p.index + 1}
                </span>
                <span className="text-muted-foreground text-[10px]">
                  {!p.isAlive ? "CAPTURED" : p.isPlaced && p.col != null ? `${COL_LABELS[p.col]}${p.row}` : "undeployed"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Exposure */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Void Pressure</h3>
          <div className="bg-background border border-border rounded p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono text-muted-foreground">Monsoons</span>
              <div className="flex gap-1">
                {[1, 2, 3].map(k => (
                  <div
                    key={k}
                    className={`w-3 h-3 rounded-sm border ${k <= monsoonsDone ? "bg-amber-500 border-amber-400" : "border-white/20"}`}
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
                    <div className="text-xl font-mono text-amber-400">{nextExposureRound - game.round}</div>
                    <div className="text-[10px] text-muted-foreground font-mono uppercase">rounds until exposure</div>
                  </>
                )}
              </div>
            ) : (
              <div className="text-xs font-mono text-amber-400 text-center">All rows lit</div>
            )}
          </div>
        </div>

        {/* Share */}
        <div className="mt-auto">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Share View</h3>
          <Button
            variant="outline"
            onClick={handleCopyLink}
            className="w-full font-mono text-xs"
          >
            Copy Spectator Link
          </Button>
          <div className="text-[10px] text-muted-foreground font-mono mt-2 break-all leading-relaxed">
            {window.location.href}
          </div>
        </div>
      </div>
    </div>
  );
}
