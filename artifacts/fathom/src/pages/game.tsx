import { useParams, useLocation } from "wouter";
import { useEffect, useState, useMemo } from "react";
import {
  useGetGame,
  useGetGameEvents,
  useGetProximityHistory,
  useSubmitMove,
  useSubmitGuess,
  useForfeitGame,
  getGetGameQueryKey,
  getGetGameEventsQueryKey,
  getGetProximityHistoryQueryKey,
  MoveInputPieceIndex,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

export default function Game() {
  const params = useParams();
  const gameId = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const token = localStorage.getItem(`fathom-token-${gameId}`) || "";

  const { data: game, isLoading, isError } = useGetGame(gameId!, {
    query: { queryKey: getGetGameQueryKey(gameId!), refetchInterval: 2000, enabled: !!gameId },
    request: { headers: { "X-Player-Token": token } }
  });

  const { data: events } = useGetGameEvents(gameId!, {
    query: { queryKey: getGetGameEventsQueryKey(gameId!), refetchInterval: 2000, enabled: !!gameId },
    request: { headers: { "X-Player-Token": token } }
  });

  const { data: proximityHistory } = useGetProximityHistory(gameId!, {
    query: { queryKey: getGetProximityHistoryQueryKey(gameId!), refetchInterval: 2000, enabled: !!gameId },
    request: { headers: { "X-Player-Token": token } }
  });

  const submitMove = useSubmitMove({ request: { headers: { "X-Player-Token": token } } });
  const submitGuess = useSubmitGuess({ request: { headers: { "X-Player-Token": token } } });
  const forfeitGame = useForfeitGame({ request: { headers: { "X-Player-Token": token } } });

  const [selectedPieceIndex, setSelectedPieceIndex] = useState<number | null>(null);
  const [selectedMoveSquare, setSelectedMoveSquare] = useState<{col: number, row: number} | null>(null);
  const [selectedGuessSquare, setSelectedGuessSquare] = useState<{col: number, row: number} | null>(null);

  // Reset selections when phase changes
  useEffect(() => {
    setSelectedPieceIndex(null);
    setSelectedMoveSquare(null);
    setSelectedGuessSquare(null);
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

  const isMover = game.currentTurnPlayer === game.yourNumber;
  const isGuesser = game.currentTurnPlayer !== null && game.currentTurnPlayer !== game.yourNumber;
  
  const canMove = isMover && game.phase === "commit_move" && !game.moveCommitted;
  const canGuess = isGuesser && game.phase === "commit_guess";

  const handleSquareClick = (col: number, row: number) => {
    const consumedRows = (6 - game.rowsRemaining) / 2;
    if (row <= consumedRows || row > (6 - consumedRows)) return; // Monsoon consumed

    if (canMove && selectedPieceIndex !== null) {
      // Validate move (king movement)
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
    submitMove.mutate({ 
      id: gameId!, 
      data: { 
        pieceIndex: selectedPieceIndex as MoveInputPieceIndex, 
        col: selectedMoveSquare.col, 
        row: selectedMoveSquare.row 
      } 
    }, {
      onSuccess: () => {
        toast({ title: "Move committed to the void" });
        queryClient.invalidateQueries({ queryKey: getGetGameQueryKey(gameId!) });
      },
      onError: () => toast({ title: "Move blocked", variant: "destructive" })
    });
  };

  const handleConfirmGuess = () => {
    if (!selectedGuessSquare) return;
    submitGuess.mutate({
      id: gameId!,
      data: { pass: false, col: selectedGuessSquare.col, row: selectedGuessSquare.row }
    }, {
      onSuccess: () => {
        toast({ title: "Guess transmitted" });
        queryClient.invalidateQueries({ queryKey: getGetGameQueryKey(gameId!) });
      },
      onError: () => toast({ title: "Guess failed", variant: "destructive" })
    });
  };

  const handlePassGuess = () => {
    submitGuess.mutate({
      id: gameId!,
      data: { pass: true }
    }, {
      onSuccess: () => {
        toast({ title: "Turn passed" });
        queryClient.invalidateQueries({ queryKey: getGetGameQueryKey(gameId!) });
      }
    });
  };

  const handleForfeit = () => {
    forfeitGame.mutate({ id: gameId! }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetGameQueryKey(gameId!) });
      }
    });
  };

  const columns = [0, 1, 2, 3, 4, 5, 6];
  const rows = [6, 5, 4, 3, 2, 1]; // from opponent home to your home

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground flex flex-col md:flex-row">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        
        {/* Top Status Bar */}
        <div className="w-full max-w-2xl mb-8 flex justify-between items-end border-b border-border pb-4">
          <div>
            <div className="text-muted-foreground text-xs uppercase tracking-widest mb-1">Status</div>
            <div className="text-xl font-mono text-primary glow-text-cyan uppercase">
              {game.status === 'waiting' && 'Waiting for opponent...'}
              {game.status === 'active' && canMove && 'Your turn to move'}
              {game.status === 'active' && canGuess && 'Your turn to guess'}
              {game.status === 'active' && !canMove && !canGuess && 'Awaiting opponent...'}
              {game.status === 'finished' && `Game Over - ${game.winner === game.yourNumber ? 'Victory' : 'Defeat'}`}
            </div>
          </div>
          <div className="text-right">
            <div className="text-muted-foreground text-xs uppercase tracking-widest mb-1">Round</div>
            <div className="text-2xl font-mono text-primary">{game.round}</div>
          </div>
        </div>

        {/* The Board */}
        <div className="relative max-w-2xl w-full select-none">
          <div className="grid grid-cols-[auto_repeat(7,1fr)_auto] gap-1">
            {/* Top Column labels */}
            <div></div>
            {['A','B','C','D','E','F','G'].map(c => <div key={c} className="text-center text-xs font-mono text-muted-foreground mb-2">{c}</div>)}
            <div></div>

            {rows.map(row => (
              <div key={row} className="contents">
                <div className="flex items-center justify-end pr-2 text-xs font-mono text-muted-foreground">{row}</div>
                {columns.map(col => {
                  const consumedRows = (6 - game.rowsRemaining) / 2;
                  const isConsumed = row <= consumedRows || row > (6 - consumedRows);
                  const yourPiece = game.yourPieces.find(p => p.col === col && p.row === row && p.isPlaced && p.isAlive);
                  const opponentPiece = game.opponentPieces.find(p => p.col === col && p.row === row && p.isVisible && p.isAlive);
                  const absRow = game.yourNumber === 1 ? 6 - row : row - 1;
                  const proxReveal = proximityHistory?.find(pr => pr.col === col && pr.row === absRow);
                  
                  const isSelectedForMove = selectedPieceIndex !== null && game.yourPieces.find(p => p.index === selectedPieceIndex)?.col === col && game.yourPieces.find(p => p.index === selectedPieceIndex)?.row === row;
                  const isMoveDest = selectedMoveSquare?.col === col && selectedMoveSquare?.row === row;
                  const isGuessDest = selectedGuessSquare?.col === col && selectedGuessSquare?.row === row;

                  // Possible move highlights
                  let isPossibleMove = false;
                  if (canMove && selectedPieceIndex !== null && !isConsumed && !yourPiece) {
                    const piece = game.yourPieces.find(p => p.index === selectedPieceIndex);
                    if (piece && !piece.isPlaced && row === 1) isPossibleMove = true;
                    else if (piece && piece.isPlaced && piece.col !== null && piece.row !== null) {
                      if (Math.abs(piece.col - col) <= 1 && Math.abs(piece.row - row) <= 1) isPossibleMove = true;
                    }
                  }

                  return (
                    <div 
                      key={`${col}-${row}`}
                      onClick={() => handleSquareClick(col, row)}
                      className={`
                        aspect-square border flex items-center justify-center relative transition-all duration-300
                        ${isConsumed ? 'bg-black/50 border-white/5 opacity-50 cursor-not-allowed' : 'bg-card border-card-border hover:border-primary/50 cursor-pointer'}
                        ${isMoveDest || isGuessDest ? 'bg-primary/20 border-primary shadow-[0_0_15px_rgba(0,255,255,0.3)]' : ''}
                        ${isSelectedForMove ? 'border-primary shadow-[0_0_15px_rgba(0,255,255,0.5)]' : ''}
                        ${isPossibleMove ? 'after:absolute after:w-2 after:h-2 after:bg-primary/50 after:rounded-full' : ''}
                      `}
                    >
                      {/* Proximity Reveal Underlay */}
                      {proxReveal && !isConsumed && (
                        <div className={`absolute inset-0 opacity-20 ${proxReveal.result === 'contact' ? 'bg-destructive' : 'bg-primary'}`}></div>
                      )}
                      
                      {/* Pieces */}
                      {yourPiece && (
                        <div className={`w-3/4 h-3/4 rounded-sm bg-primary/80 border border-primary glow-cyan flex items-center justify-center text-primary-foreground font-mono font-bold text-xs ${yourPiece.isVisible ? 'bg-primary border-white' : ''}`}>
                          {yourPiece.strideCount}
                        </div>
                      )}
                      {opponentPiece && (
                        <div className="w-3/4 h-3/4 rounded-sm bg-destructive border border-destructive/50 shadow-[0_0_15px_rgba(255,0,0,0.5)] flex items-center justify-center text-destructive-foreground font-mono text-xs">
                          !
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-start pl-2 text-xs font-mono text-muted-foreground">{row}</div>
              </div>
            ))}

            {/* Bottom Column labels */}
            <div></div>
            {['A','B','C','D','E','F','G'].map(c => <div key={c} className="text-center text-xs font-mono text-muted-foreground mt-2">{c}</div>)}
            <div></div>
          </div>
        </div>

        {/* Action Controls */}
        {game.status === 'active' && (
          <div className="mt-8 w-full max-w-2xl p-6 bg-card border border-card-border rounded flex flex-col md:flex-row items-center justify-between gap-4">
            
            {canMove && (
              <div className="flex flex-col md:flex-row items-center gap-4 w-full">
                <div className="flex gap-2">
                  {game.yourPieces.map(piece => (
                    <Button 
                      key={piece.index}
                      variant={selectedPieceIndex === piece.index ? "default" : "outline"}
                      className={`font-mono ${selectedPieceIndex === piece.index ? 'glow-cyan' : ''}`}
                      onClick={() => {
                        setSelectedPieceIndex(piece.index);
                        setSelectedMoveSquare(null);
                      }}
                      disabled={!piece.isAlive}
                    >
                      {piece.isPlaced ? `Piece ${piece.index + 1}` : `Deploy ${piece.index + 1}`}
                    </Button>
                  ))}
                </div>
                <Button 
                  onClick={handleConfirmMove}
                  disabled={!selectedMoveSquare || submitMove.isPending}
                  className="w-full md:w-auto ml-auto font-mono uppercase tracking-wider"
                >
                  {submitMove.isPending ? "Transmitting..." : "Commit Move"}
                </Button>
              </div>
            )}

            {canGuess && (
              <div className="flex flex-col md:flex-row items-center gap-4 w-full">
                <div className="text-sm font-mono text-muted-foreground">Select a square to guess, or pass</div>
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" onClick={handlePassGuess} disabled={submitGuess.isPending}>Pass</Button>
                  <Button 
                    onClick={handleConfirmGuess}
                    disabled={!selectedGuessSquare || submitGuess.isPending}
                    className="font-mono uppercase tracking-wider"
                  >
                    Commit Guess
                  </Button>
                </div>
              </div>
            )}

            {!canMove && !canGuess && (
              <div className="text-sm font-mono text-muted-foreground animate-pulse text-center w-full">
                {game.phase === "commit_move" ? "Opponent is maneuvering in the dark..." : "Opponent is attempting a read..."}
              </div>
            )}

          </div>
        )}
      </div>

      {/* Sidebar (Logs & Status) */}
      <div className="w-full md:w-80 bg-card/50 border-l border-border p-6 flex flex-col h-[50vh] md:h-screen">
        
        <div className="mb-6">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Monsoon Alert</h3>
          <div className="bg-background border border-border p-4 rounded text-center">
            <div className="text-sm font-mono text-muted-foreground">Rounds until contraction</div>
            <div className="text-3xl font-mono text-destructive mt-2 glow-text-cyan shadow-none text-shadow-[0_0_10px_rgba(255,0,0,0.5)]">
              {game.monsoon.nextMonsoonRound - game.round > 0 ? game.monsoon.nextMonsoonRound - game.round : 0}
            </div>
            <div className="text-xs text-muted-foreground mt-2 font-mono">Row {game.rowsRemaining} remaining</div>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Event Log</h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-2 font-mono text-xs">
            {events?.slice().reverse().map(ev => (
              <div key={ev.seq} className="p-2 bg-background border border-border rounded border-l-2 border-l-primary opacity-80">
                <div className="text-[10px] text-muted-foreground mb-1">R{ev.round} • {new Date(ev.timestamp).toLocaleTimeString()}</div>
                <div className="text-foreground">
                  {ev.data.message || ev.eventType.replace(/_/g, ' ')}
                </div>
              </div>
            ))}
            {(!events || events.length === 0) && (
              <div className="text-muted-foreground text-center p-4 italic">No events recorded.</div>
            )}
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-border">
          <Button variant="destructive" onClick={handleForfeit} className="w-full font-mono text-xs uppercase" disabled={game.status === 'finished'}>
            Forfeit Game
          </Button>
        </div>
      </div>
    </div>
  );
}