# Frontend React: roteamento, sockets e sincronização de tempo
> src/ — os três modos (Quem Sou Eu, Impostor, Caracol) e o lobby

Entry: `src/main.tsx:DedicatedEntry()` — `VITE_GAME_SERVICE` decide qual app sobe (`LobbyApp`, `CaracolGame`, ou `App` com seletor de modo). Rota legada `?game=caracol` redireciona para `VITE_CARACOL_URL`.

## Árvore por modo

- **Quem Sou Eu / Impostor** — `src/App.tsx:App()`: Homepage → Lobby → Playing (whoami: `CharacterCard[]` + guess panel + `NotesPanel` + sistema de dicas; draw-impostor: `src/DrawingGame.tsx:DrawingRound()` com canvas de traços, timer de turno, formulário de acusação/chute) → Finished (ranking + reveal).
- **Caracol** — `src/CaracolGame.tsx:CaracolGame()`: Auth (login/registro) → seleção de cidade (`CityPicker` + `BrazilMap` + `RouletteCard`) → tela de jogo (mapa, carteira, roleta, loja, histórico, lista de jogadores).
- **Arte do Caracol** — `src/caracolArt/`: `PLAYER_ART`/`SNAIL_ART` são registros de funções que desenham cada camada (fringe, olhos, roupa, etc.); `CaracolFigure()` (`src/CaracolAvatar.tsx:46`) monta as camadas por outfit e aplica filtro de "tinta" (SVG `feTurbulence`+`feDisplacementMap`) só quando `sizePx >= 56px`.

## Dois sockets independentes

- `src/socket.ts` — `socket` global para Lobby/Quem Sou Eu/Impostor. Eventos: `room:state`, `round:started`/`round:guess`/`guess:result`, `player:solved`, `draw:*` (stroke/accuse/guess-word/pass/end), `hint:*` (request/answer/cancel), `room:notice`, `error`.
- `src/caracolSocket.ts` — `caracolSocket`, socket separado, `autoConnect: false`. Eventos: `caracol:state`, `caracol:register`/`login`/`resume`/`sync` (todos com ack), `caracol:select-city`/`redirect`/`buy-speed`/`buy-discount`/`roulette`/`boomerang`/`shop-purchase`/`shop-equip`/`history` (com ack), `caracol:notice` (aviso global), `caracol:death`, `caracol:history-added`, `caracol:visibility`, `caracol:push-subscribe`.

## Sincronização de tempo do servidor (mesmo padrão, duas implementações)

- Whoami: `useRoundClock()` (App.tsx:593) — `offset = serverNow - Date.now()` recalculado a cada `room:state`, tick local de 1s só durante `playing`.
- Caracol: `useServerNow()` (CaracolRoulette.tsx:19) — mesmo `skew`, mas tick de 1 **minuto** (cooldowns de 24h não precisam de precisão de segundo).

## Gotchas

- **Hibernação de servidor**: se `VITE_SERVER_URL` está definida (deploy cross-origin), `wakeServer()` (socket.ts:53) faz polling em `/healthz` a cada 2s por até 90s antes de conectar o socket — mesma origem não precisa disso.
- **`sessionStorage` guarda coisas diferentes por jogo**: Quem Sou Eu usa chave `quem-sou-eu:session` (roomCode/playerId/sessionToken/nickname); Caracol usa `caracol:session-token` separado; notas usam `quem-sou-eu:notes:${roomCode}:${round}` — muda a cada rodada, nunca guarda o personagem secreto (ver README.md "Privacidade da rodada").
- **`CaracolFigure` é `memo()` com comparador customizado** (`sameFigureProps()`, CaracolAvatar.tsx:35) — servidor manda estado novo a cada segundo com objetos de outfit recriados; sem a comparação por valor, o SVG seria redesenhado ~60x/min à toa.
- **Giro de roleta tem timeout de ack de 10s** (`caracolSocket.timeout(10s).emit('caracol:roulette', ...)`) — se a conexão cair, o botão libera sozinho em vez de travar esperando um ack que nunca chega. Giro de **outro** jogador chega via `caracol:notice`, não como resposta direta.
- **Blooper esconde no cliente porque o servidor já não manda o dado** — não é uma checagem de UI, `lat/lon/distance/eta` vêm `null` (ver `.notebook/caracol-servidor-motor-e-roleta.md`).
- **NotesPanel é 100% local** — nenhum evento de socket, só `sessionStorage`; usa `useLayoutEffect` para redimensionar (precisa passar por `height: auto` antes de medir `scrollHeight`, senão a altura só cresce, nunca encolhe); limite de 2000 caracteres.
- **Palavra do modo Impostor nunca chega ao cliente do impostor** — `drawRole === 'impostor'` só recebe categoria, nunca a palavra em si; reflete a mesma regra do servidor (ver `.notebook/nucleo-servidor-whoami-impostor.md`).

## Termos de domínio

- **NotesPanel** — bloco de notas privado e offline para rabiscar pistas durante a rodada.
- **Outfit** — combinação atual de cosméticos (pants/shirt/watch/glasses/cap).
- **Medallion** — retrato circular do avatar com tons por estado (default/you/target/dead/equipped).
- **Synced** — timestamp do último `caracol:state` completo recebido, exibido como "sincronizado"/"sincronizando".

## Ver também

- `.notebook/nucleo-servidor-whoami-impostor.md` — contraparte servidor dos eventos de sala/rodada
- `.notebook/caracol-servidor-motor-e-roleta.md` — contraparte servidor do Caracol

Updated: 2026-09-21
