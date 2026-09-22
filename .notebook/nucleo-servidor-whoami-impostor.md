# Núcleo do servidor: Quem Sou Eu + Quem é o Impostor
> Ciclo de sala/rodada dos dois modos "tradicionais" (não-Caracol)

Entry: `server/index.ts` (bootstrap Express + Socket.IO, `GAME_SERVICE` decide quais motores sobem)
Manager: `server/game.ts:createGameManager()` — todo o estado de sala vive em memória, perdido no restart.

## Fluxo Quem Sou Eu

`room:create`/`room:join` → `server/game.ts:createRoom()`/`joinRoom()` → lobby.
`player:ready` → `setReady()` → quando `players.size >= 2` e todos prontos/conectados → `startRound()` (L570).

`startRound()`:
- Congela `room.roundPlayerCount` (vale para toda a rodada, mesmo se alguém sair depois)
- `server/wordlist.ts:pickCharacters()` (L214) — Fisher-Yates excluindo `usedCharacterIds`, recicla catálogo quando esgota
- Broadcast `round:started`

`guess()` (L277) → normaliza (`server/normalization.ts:normalizeText()`) → `characterMatches()` (wordlist.ts:225, compara nome+aliases normalizados) → acerto: `rank = nº já resolvidos + 1`, pontos = `server/scoring.ts:pointsForRank(rank, roundPlayerCount)` = `roundPlayerCount - rank + 1` (último sempre leva 1). Todos resolvem → `finishRound()` (L861).

## Fluxo Quem é o Impostor (draw-impostor)

`startDrawingRound()` (L616): sorteia impostor, palavra via `server/drawing-wordlist.ts:pickDrawingWord()`, embaralha ordem de turno, agenda timeout se `drawTurnMs` != null.

Turnos: `addDrawingStroke()` (L652, máx 240 pontos/traço, largura 1-18px) → `passDrawingTurn()` (L683) ou timeout → `advanceDrawingTurn()` (L825). Timeout agenda com `delay + 30ms` de margem para jitter de rede (`scheduleDrawingTurn()` L812).

Resolução (1 tentativa cada):
- Desenhador acusa impostor: `accuseDrawingImpostor()` (L701) — acerta → grupo vence; erra → `drawEliminated=true`, se todos erraram → impostor vence.
- Impostor chuta a palavra: `guessDrawingWord()` (L760) — acerta → impostor vence; erra → grupo vence.
- Anfitrião pode `endDrawingRound()` (L793) e revelar sem vencedor (só quando `drawTurnMs === null`, "sem limite").

`finishRound()`/`finishDrawingRound()` → `round:finished` com ranking → `playAgain()` (L532) volta a `lobby`.

## Gotchas

- **`roundPlayerCount` é congelado no início da rodada** (`RoomState.roundPlayerCount`) — quem sai durante `playing` não recalcula a pontuação de quem acerta depois.
- **`solveMs` nunca é armazenado**, sempre `player.solvedAt - room.roundStartedAt` (L1229) — mesma lógica de "derivar, nunca agendar" do AD registrado em `.specs/STATE.md` (AD-003) para tempo, aplicada aqui a pontuação.
- **Personagem só é visível a quem já acertou ou pós-rodada** — `viewRoom()` (L1008): mostra `player.character` se `phase === 'finished'` ou (`playing` e `viewer !== player`). O próprio dono nunca vê o personagem antes de acertar.
- **Impostor nunca vê a palavra ao vivo** — `viewDrawing()` (L1024) só mostra a palavra para `drawRole === 'drawer'` ou `phase === 'finished'`.
- **Sair durante `playing` aborta a rodada inteira** — `leave()` → `resetAfterDeparture()` (L1200) volta tudo a `lobby`. Não há timeout de rodada; uma queda de conexão trava, então o design escolhe abortar em vez de travar.
- **`endEarly()` só libera se há alguém desconectado e não resolvido** — evita usar o botão como atalho para sabotar quem ainda está jogando normalmente.
- **Power-ups de dica são derivados do cronômetro, nunca agendados** — `shared/hints.ts:availableHintPowerups(elapsedMs, used)` recalcula os marcos (30/40/50 min, teto 3) a cada payload; ver AD em `.specs/STATE.md` sobre TIME-09 (guarda de agendador único em `server/game.ts`).
- **Se o alvo de uma dica cai, o pedido é liberado de volta** — `releaseHintRequestsTargeting()` (L526), chamado em `disconnect()`/`leave()`.
- **Catálogo tem piso mínimo verificado no bootstrap**: 250 personagens / 150 palavras de desenho, senão lança `Error` ao subir (wordlist.ts:207, drawing-wordlist.ts:88). Ver também `.notebook/palpite-vs-catalogo.md` para o acoplamento com `MIN_GUESS_LENGTH`.
- **Aliases incluem o nome original em inglês** (`mergeAliases()`, wordlist.ts:36) mesmo o nome exibido sendo a forma brasileira — reflete AD-001 de `.specs/STATE.md`.
- **Código de sala evita caracteres ambíguos**: alfabeto sem `0/O/I/L` (`ROOM_CODE_ALPHABET`, L34).

## Termos de domínio

- `roundPlayerCount` — nº de jogadores congelado no início da rodada, base da fórmula de pontos.
- `drawRole` — `'drawer'` ou `'impostor'` no modo desenho.
- `drawEliminated` / `drawAccusationUsed` / `drawWordGuessUsed` — flags de tentativa única já usada.
- `alias` — nome alternativo aceito como palpite (ex.: "Spider-Man" alias de "Homem-Aranha").
- `usedCharacterIds` — Set por sala para não repetir personagem até reciclar o catálogo.

## Ver também

- `shared/protocol.ts` — todos os tipos de rede (`RoomView`, `PlayerView`, `DrawGameView`, eventos client↔server)
- `.notebook/palpite-vs-catalogo.md` — piso de `MIN_GUESS_LENGTH` acoplado ao catálogo
- `.specs/STATE.md` — decisões AD-001..004 (nomenclatura, reciclagem, relógio do servidor, remoção de créditos)

Updated: 2026-09-21
