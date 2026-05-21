import { useLocation } from "wouter";
import { useCreateGame, useJoinGame, useListGames, getListGamesQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createGame = useCreateGame();
  const joinGame = useJoinGame();
  const { data: games } = useListGames({ query: { queryKey: getListGamesQueryKey() } });

  const [createName, setCreateName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinId, setJoinId] = useState("");

  const handleCreate = () => {
    if (!createName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    createGame.mutate({ data: { playerName: createName } }, {
      onSuccess: (res) => {
        localStorage.setItem(`fathom-token-${res.gameId}`, res.playerToken);
        localStorage.setItem(`fathom-name-${res.gameId}`, res.playerName);
        setLocation(`/game/${res.gameId}`);
      },
      onError: () => {
        toast({ title: "Failed to create game", variant: "destructive" });
      }
    });
  };

  const handleJoin = (gameId: string, name: string) => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    joinGame.mutate({ id: gameId, data: { playerName: name } }, {
      onSuccess: (res) => {
        localStorage.setItem(`fathom-token-${res.gameId}`, res.playerToken);
        localStorage.setItem(`fathom-name-${res.gameId}`, res.playerName);
        setLocation(`/game/${res.gameId}`);
      },
      onError: () => {
        toast({ title: "Failed to join game", variant: "destructive" });
      }
    });
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-12">
        <div className="text-center space-y-4">
          <h1 className="text-6xl font-bold tracking-tighter text-primary glow-text-cyan uppercase">FATHOM</h1>
          <p className="text-muted-foreground text-lg tracking-wide uppercase">Into the void</p>
        </div>

        <div className="space-y-8 bg-card border border-card-border p-8 rounded-lg shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50"></div>
          
          <div className="space-y-4">
            <h2 className="text-xl font-semibold uppercase tracking-wider text-foreground">Create Game</h2>
            <div className="flex gap-2">
              <Input 
                placeholder="Your Name" 
                value={createName} 
                onChange={(e) => setCreateName(e.target.value)} 
                className="bg-muted border-muted-border font-mono text-sm"
              />
              <Button 
                onClick={handleCreate} 
                disabled={createGame.isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/90 min-w-[120px]"
              >
                {createGame.isPending ? "Starting..." : "Initiate"}
              </Button>
            </div>
          </div>

          <div className="h-px w-full bg-border"></div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold uppercase tracking-wider text-foreground">Join Private</h2>
            <div className="space-y-2">
              <Input 
                placeholder="Game ID" 
                value={joinId} 
                onChange={(e) => setJoinId(e.target.value)} 
                className="bg-muted border-muted-border font-mono text-sm"
              />
              <div className="flex gap-2">
                <Input 
                  placeholder="Your Name" 
                  value={joinName} 
                  onChange={(e) => setJoinName(e.target.value)} 
                  className="bg-muted border-muted-border font-mono text-sm"
                />
                <Button 
                  onClick={() => handleJoin(joinId, joinName)} 
                  disabled={joinGame.isPending || !joinId}
                  variant="secondary"
                  className="min-w-[120px]"
                >
                  {joinGame.isPending ? "Connecting..." : "Connect"}
                </Button>
              </div>
            </div>
          </div>
          
          <div className="h-px w-full bg-border"></div>

          <div className="space-y-4">
            <h2 className="text-xl font-semibold uppercase tracking-wider text-foreground flex items-center justify-between">
              <span>Open Signals</span>
              {games && games.length > 0 && (
                <span className="text-primary text-xs font-mono glow-text-cyan">{games.length} detected</span>
              )}
            </h2>
            {(!games || games.length === 0) ? (
              <div className="p-4 text-center border border-dashed border-border text-muted-foreground text-sm font-mono uppercase">
                No active signals
              </div>
            ) : (
              <div className="space-y-2">
                {games.map(game => (
                  <div key={game.id} className="flex items-center justify-between p-3 bg-muted rounded border border-border group hover:border-primary/50 transition-colors">
                    <div className="flex flex-col">
                      <span className="font-mono text-primary text-sm">{game.player1Name}</span>
                      <span className="text-xs text-muted-foreground font-mono truncate max-w-[150px]">{game.id}</span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleJoin(game.id, joinName || "Player 2")} className="font-mono text-xs uppercase group-hover:bg-primary group-hover:text-primary-foreground">
                      Intercept
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
