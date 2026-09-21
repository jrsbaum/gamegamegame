# Caracol: motor do servidor (tick, perseguição, roleta, economia)
> Partida global única e persistente — servidor autoritativo, um caracol perseguindo um alvo por vez

Entry: `server/caracol/game.ts` (motor), `server/caracol/store.ts` (persistência Postgres/memória), `shared/caracol.ts` (protocolo + catálogo).

## Loop de perseguição

`tickInternal()` (game.ts:1151) roda a cada 1s (`TICK_MS`):
- `ensureTarget()` (L1091): 1º prioriza Casco vermelho ativo de alguém perseguível (mais recente vence); senão mantém alvo atual se ainda válido; senão escolhe o vivo+com-cidade mais próximo (Haversine, `geo.ts:distanceKm()`); senão alvo `null` ("dormindo em Brasília").
- Distância percorrida no tick = `speedKmh × elapsedMs / 3_600_000`; se ≥ distância até o alvo → `eliminate()` (L1187, zera moedas da vítima); senão `moveTowards()` (geo.ts:21, interpolação geodésica).
- Velocidade é **sempre a mesma para todo mundo** (nível global comprado por qualquer jogador), exceto Banana que multiplica ×1.5 só contra o dono do item (`chaseSpeedKmh()`, L1037).

## Economia: moedas pagas em lote, nunca por período

- Online: 10 moedas/10s. Offline: 1 moeda/10s. `accrueCoins()` (L1358) calcula `intervals = floor((now - lastCoinAccruedAt) / COIN_INTERVAL_MS)` e credita tudo de uma vez ao reconectar/gastar/tick — **não há taxa acumulada por multiplicador de tempo**.
- **Regra de ouro do design** (`shared/caracol.ts:68-73`, comentário no código): nenhum item altera a taxa de ganho por tempo. Um efeito "2× por 6h" atravessando uma desconexão de 12h não saberia dizer quanto tempo o efeito esteve ativo — por isso os itens de economia (Moeda, Raio, Bomba) só mexem no **saldo instantâneo** ou no **preço de compra**, nunca na taxa.
- `settleCoins()` (L1367) sempre liquida o pendente antes de qualquer operação que mexa em saldo.

## Roleta (13 itens, 50/50 sempre)

`drawRouletteItem()` (game.ts:785): sorteia categoria `buff`/`debuff` com 50% cada, depois item uniforme dentro da categoria — 50/50 garantido **independente de quantos itens existem em cada lado** (7 buffs, 6 debuffs).

Efeitos em `caracol_effects` (id = `scope:accountId:itemId`):
- Instantâneo (Bomba, Bullet Bill): não persiste.
- Por tempo (Star 2h, Moeda 6h): vence por relógio.
- Por carga (Cogumelo 1 uso, Flor 3 usos): vence por uso OU tempo, o que vier primeiro.
- Escopo `account` (12 itens) ou `world` (só Raio, afeta todo mundo).
- Tirar o mesmo item de novo com efeito ainda ativo **renova** expiração e recarrega ao máximo — nunca soma (`rouletteOutcome()`, L794).
- Cooldown de giro: 24h corridas desde `lastRouletteAt`, serializado por fila de mutações contra double-click.

## Preço: uma fórmula, quatro consumidores

`price()` (game.ts:1047): `max(piso, floor(base × 0.75^speedDiscountLevel × 0.5 se Moeda × 2 se Raio))`. Usada por `redirectCost()` (base `8×2^redirectLevel`, cresce exponencialmente a cada redirect), `speedCost()`, `discountCost()` e `shopPrice()` (cosméticos).

## Gotchas

- **Casco vermelho é estado, não ação** — tirar o item já vira o alvo do caracol instantaneamente para o dono; redirect de outro jogador para longe dele é recusado sem custo (checagem acontece antes de cobrar).
- **Escudo defensivo absorve o ataque e o custo do atacante junto** (`absorbAttack()`, L715) — quem atacou já pagou/gastou carga mesmo o ataque não fazendo efeito; resposta ainda é `ok: true`.
- **Super Star vence Casco vermelho** no mesmo alvo; se houver múltiplos Cascos no mundo, vale o de `createdAt` mais recente, e ao expirar volta ao anterior se ainda ativo.
- **Blooper esconde no servidor, não no cliente** — `stateFor()` (L1285) envia `lat/lon/distance/eta = null, hidden: true` para quem tem o efeito; não é um "some visualmente", o dado realmente não sai do servidor.
- **Morte não limpa efeitos, cooldown de roleta nem desconto** — só reseta `lastCoinAccruedAt` (fecha o período anterior). Deliberado: senão morrer de propósito seria um jeito de escapar de um debuff como Banana.
- **Fila de mutações serializa tudo que mexe em moeda/carga** (giro, bumerangue, redirect, compra, aceleração, desconto) — o tick fica fora da fila porque não pode esperar rede de terceiros.
- **Aproximação notifica uma vez só** — `approachingSent` (L1214) rastreia quem já foi avisado por push; limpa ao trocar de alvo ou usar Cogumelo.

## Schema Postgres (store.ts:156)

- `caracol_accounts` — conta, moedas, cidade (CHECK all-or-nothing), `speed_discount_level`, cosméticos, `last_coin_accrued_at`, `last_roulette_at`.
- `caracol_world` (singleton `id=1`) — posição do caracol, `speed_level`, `redirect_level`, `target_account_id`.
- `caracol_effects` — id `scope:accountId:itemId`, `expires_at`, `charges` (derivado ao ler, sem timer agendado).
- `caracol_history` — feed público auditável.
- `caracol_push_subscriptions` — endpoints VAPID.

Commits usam `CaracolCommit` (store.ts:68) transacional (`BEGIN...COMMIT`) para mutações que tocam múltiplas contas + mundo + efeitos numa tacada.

## Gotcha corrigido: sessão deslogava sozinha e a cada deploy (mesma causa)

`this.sessions` (game.ts:123, tokenHash → accountId) era só um `Map` em memória, nunca recarregado do `loadSnapshot()`. Qualquer reinício do processo — deploy, crash, ou o Render hibernando/acordando (ver README.md, plano gratuito) — zerava o mapa inteiro. O próximo `caracol:resume` de qualquer jogador caía em `SESSION_EXPIRED` mesmo com a conta intacta no Postgres. Corrigido persistindo em `caracol_sessions` (hash do token, nunca o token em si) e recarregando no `initialize()`; ver AD-005 em `.specs/STATE.md`. Sem expiração automática — token só morre em logout explícito.

## Termos de domínio

- **Tick** — iteração de 1s que move o caracol, paga moedas online e revê efeitos vencidos.
- **Liquidação (settleCoins)** — cálculo/pagamento de moedas acumuladas desde a última liquidação.
- **Carga (charge)** — contador de usos restantes de um efeito.
- **Encarecimento** — `redirectLevel` sobe a cada redirect, dobrando o custo do próximo.

## Ver também

- `.notebook/depurar-timeout-de-socket.md` — mesma família de bug de "timeout esperando evento" pode aparecer em testes de integração do Caracol.
- README.md (raiz) — seção "Caracol em produção" (volume Postgres, VAPID, regra do 404/410 removendo subscription automaticamente).
- `plano/roleta-do-caracol-spec.md`, `plano/decisoes.md` — spec e decisões de design da roleta.

Updated: 2026-09-21
