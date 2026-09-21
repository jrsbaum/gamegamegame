# LaFarmer: visão geral
> Subprojeto isolado em `lafarmer/` — jogo de fazenda multiplayer persistente, sem relação com "whoami"

Entry: `lafarmer/README.md`, monorepo próprio com workspaces npm.

## O que é

MVP de fazenda multiplayer num mundo persistente e compartilhado. Cada jogador escolhe **uma** especialização exclusiva na onboarding (`fruits` | `vegetables` | `dinosaurs`) que define o que a fazenda principal produz — não dá pra trocar depois, mas o mercado permite comprar/vender qualquer item. Não há recuperação de senha: conta perdida é conta perdida (mesmo padrão do Caracol no jogo principal — ver `.notebook/*caracol*`).

## Arquitetura (monorepo)

```
lafarmer/
├── apps/server   → Fastify + ws, autoritativo (game-service.ts, domain.ts, auth-service.ts, websocket-gateway.ts)
├── apps/web      → Vite + Phaser 4 (main.ts = state machine auth→onboarding→game, game.ts = WorldScene)
├── packages/content        → tipos/catálogos puros (ITEM_CATALOG, WORLD_REGIONS, constantes)
└── packages/content-client → content + assets visuais (outfits, hairs, OKLCH)
```

Fluxo: `content` → `content-client` (consumido pelo `web` para renderizar) e `content` também é importado direto pelo `server` para validar ações. Servidor é autoritativo: movimento/plantio/compra são validados no server antes de propagar via WebSocket.

Persistência: `apps/server/src/persistence.ts` escolhe adaptador — `postgres-store.ts` se `DATABASE_URL` e `NODE_ENV !== test`, senão `in-memory-store.ts` (usado nos testes).

## Rodar local

```bash
cd lafarmer && npm install && npm run build
npm run dev:web     # :5173
npm run dev:server  # :3337 (tsx)
npm test            # vitest, força in-memory
```

## Deploy (Dokploy)

Nginx (web, porta 80 interna) + Fastify (server, porta 4000, expõe `/api`, `/ws`, `/healthz`) + PostgreSQL (porta privada). Traefik roteia por `Host` + `PathPrefix`. Variáveis nunca versionadas: `WEB_DOMAIN`, `POSTGRES_*`, `DATABASE_URL`, `SESSION_SECRET` (não pode mudar entre reinícios — sessões usam HMAC com ele), `CORS_ORIGIN`. Detalhe completo em `lafarmer/docs/deploy-dokploy.md`.

## Gotchas

- **Economia offline vs online**: online credita 10 moedas/min (tick de 60s enquanto WebSocket ativo, `ONLINE_ACTIVITY_WINDOW_MS=90s` de janela de "atividade"); offline credita 1 moeda/min até 24h de teto. Ao reconectar, `GameService.resume()` calcula o atraso e credita de uma vez como `WalletEntry` motivo `offline_reward`.
- **Especialização é irreversível** — escolhida uma vez na onboarding, trava o tipo de produção da fazenda principal para sempre.
- **Compra no mercado exige `idempotencyKey`** (regex `/^[a-zA-Z0-9._:-]{1,128}$/`), com recibo guardado em memória — retry da mesma chave retorna o resultado anterior em vez de duplicar a transação.
- **Sem rate limiting no WebSocket** (pré-MVP, deliberado) — mensagens só são serializadas por cliente via fila (`messageQueues.get(client)`).
- **Mundo 80×60 tiles (48px/tile)**, regiões com status `locked`/`occupied`/`frontier`; jogador mora em uma região (`homeRegionId`) mas visita vizinhas via `Connection` (gate/bridge/path com coordenadas de entry/exit).

## Termos de domínio

- **Specialization** — fruits/vegetables/dinosaurs, escolha única e definitiva.
- **Quality** — common/good/perfect, melhora com `Care`.
- **Offline Reward** vs **Online Tick** — dois regimes de ganho passivo, ver Gotchas.
- **World Presence** — snapshot em tempo real de um jogador online (posição, aparência).
- **Region / Connection / Frontier** — topologia do mundo persistente.
- **Behavior State** (animais: idle/wander/hungry/eating/happy/produce) e **Care State** (awaiting-care/attended).

## Ver também

- `lafarmer/docs/deploy-dokploy.md` — runbook completo de deploy
- `packages/content/src/index.ts` — fonte única de catálogos e constantes de mundo

Updated: 2026-09-21
