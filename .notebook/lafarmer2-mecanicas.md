# La Farmer 2: mecânicas e furos do cliente 1
> Workspace isolado em `apps/lafarmer2`. O jogo 1 em `apps/lafarmer` continua a fonte copiada do servidor, não o alvo de correção.

Entry: `apps/lafarmer2/AGENTS.md`
Fluxo pretendido: auth → confirmação só no registro → onboarding 4 etapas se perfil incompleto → vale 3D → loja → plantar/adotar → cuidar/colher → mercado no tile real → visita por conexão.

## Servidor do jogo 1 (regras a preservar)

Autoridade: `apps/lafarmer/apps/server/src/game-service.ts:GameService`
Contrato HTTP: `apps/lafarmer/apps/server/src/http.ts:createApp()`
WebSocket: `apps/lafarmer/apps/server/src/websocket-gateway.ts` — tipos em `isFarmMessage()` incluem `farm.plant` e `farm.adopt`
Auth / nick / sem recuperação: `apps/lafarmer/apps/server/src/auth-service.ts:AuthService.register()`, `login()`
Persistência: `apps/lafarmer/apps/server/src/persistence.ts:createPersistence()` — memória se sem `DATABASE_URL` ou `NODE_ENV=test`

- Especialização irreversível após assentamento: `apps/lafarmer/apps/server/src/auth-service.ts:AuthService.updateProfile()` + `GameService.plant()` / `adopt()` (`specialization_locked`)
- Plantio ≤ 8 tiles, chão andável: `apps/lafarmer/apps/server/src/game-service.ts:validPosition()`
- Estoque 50: `INVENTORY_CAPACITY` em `apps/lafarmer/packages/content/src/index.ts` + `addInventory()`
- Compra idempotente: `GameService.buyListing()` + header `idempotency-key` em `http.ts`
- Offline 12/h teto 24h: `GameService.resume()` (`OFFLINE_COINS_PER_HOUR`, `OFFLINE_CAP_SECONDS`)
- Online 10× enquanto WS ativo: `markOnlineActivity()`, `onlineTick()` (`ONLINE_ACTIVITY_WINDOW_MS`)
- Visita só por conexão e região ocupada: `GameService.enterRegion()` + `world-service.ts:getConnection()`
- Dino exige recinto: `GameService.adopt()` + `dinosaur_enclosure` em `buildStructure()`
- Catálogo vaca existe: `CONTENT_CATALOG` id `cow` em `packages/content/src/index.ts` (`care`, `wander`, `produce`, input `feed`)

## O que o cliente 1 quebra

Roteamento: `apps/lafarmer/apps/web/src/main.ts` — após `register()`/`login()` sempre `screen = 'confirm'`; `renderConfirm()` sempre vai para onboarding. Sem ramo para perfil já assentido.

Plantio/adoção: `apps/lafarmer/apps/web/src/game.ts:WorldScene.interact()` — só `farm.care` / `farm.harvest` / `farm.collect` / visita / mercado. Não chama `farm.plant` nem `farm.adopt`. Loja em `openOriginShopPanel()` só incrementa inventário.

Mercado no tile errado: `WorldScene.interact()` usa `gridToWorld(31, 18)`. Prédio real: `WORLD_OBSTACLES` kind `market` em `(62, 21)` em `packages/content/src/index.ts`.

Estruturas: `main.ts:renderGame()` chama `buildStructure()` HTTP e atualiza moedas; `WorldScene.renderStructure()` só roda em `applySnapshot()`. Sem `farm.structure.build` no cliente após o POST.

Inventário / guarda-roupa: sidebar em `main.ts` só escreve texto em `#sidebar-message`. Sem painel de itens/qualidade nem `PATCH` de aparência no jogo.

Anúncio: `openMarketPanel()` chama `createListing(..., 1, 30)` — quantidade e preço fixos.

Vaca morta no cliente e no `adopt()`: `GameService.adopt()` recusa `definition.id !== "dinosaur"`. `ORIGIN_SHOP_OFFERS` não tem ração. Cliente não vende `animal_pen` de forma explícita (botão construir só escolhe recinto/pomar/campo).

## O que o jogo 2 corrige

App: `apps/lafarmer2` (`@lafarmer2/content`, `@lafarmer2/server`, `@lafarmer2/web`). Portas 3338 / 5176. Store local em memória. `/healthz`.

Cliente Three.js: `apps/lafarmer2/apps/web/src/world/WorldView.ts` — malhas por `visualKey`, estruturas no retorno de construir, mercado no tile `market` do catálogo.

Roteamento: `apps/lafarmer2/apps/web/src/next-screen.ts:nextScreenAfterAuth()` — confirmação só se `justRegistered`; perfil completo → `game`.

Plantio/adoção: `WorldView.interact()` envia `farm.plant` / `farm.adopt` com tile à frente e insumo no estoque.

Economia: painéis de inventário (nome + qualidade), anúncio com quantidade/preço, guarda-roupa via `updateProfile` sem terra/especialização.

Vaca: oferta `feed` na loja `dinosaurs`; `adopt("cow")` exige `animal_pen` + ração; dino continua exigindo `dinosaur_enclosure` + ovo/fóssil.

## Movimento no vale 3D

Cliente: `WorldView.ts` usa `controller.ts:stepWalker()` e `chaseCamera.ts`. Cada tile que o centro atravessa vira um `move` de 1 passo (`sprint` fica no cliente). O servidor ainda anda 1 tile, ou 2 se `sprint`, e não recusa o passo: se o primeiro tile está bloqueado, `move_ack` volta com a posição antiga.
Spawn: `PLAYER_SPAWN` em `packages/content/src/index.ts` — (20, 12). O tile (8, 8) encosta nas árvores (9, 7), (10, 7) e (11, 8).

A câmera nasce olhando para o leste (`INITIAL_CAMERA_YAW`), atrás do fazendeiro. W segue o eixo da câmera. O braço encolhe em sólido e sobe no terreno; não mire o yaw inicial no coração (42, 30).

O nariz do fazendeiro local acompanha o yaw da câmera (`WorldView.orientFarmer()` depois de `chase.update`), não o vetor do passo. `movement.ts:farmerRootYaw()` devolve esse yaw: +Z local vai para `(sin yaw, cos yaw)`. O sinal negativo apontava o rosto para a lente. A/D e S não giram o corpo; `stepWalker()` não mexe no heading. Remotos usam o mesmo yaw no heading do deslocamento.

Estrutura própria bloqueia o corpo mesmo com o fazendeiro em cima (dá para sair). Estrutura alheia bloqueia só por fora. Colheita de tomate (`cycleSeconds` null) some no `farm.harvested`; a laranjeira espera o snapshot. `valley.ts` e `actors.ts` saíram; `movement.ts` fica por causa de `chooseWalk` e do tipo `Direction`.

## Grama

`grass.ts:bladeTuft()` sem `shape` termina em ponta (juncos). O relvado passa `shape` com duas fitas cruzadas e pouco `droop`. Uma fita deitada mostra à câmera de perseguição só a borda fina e volta a parecer agulha.

Updated: 2026-09-27
