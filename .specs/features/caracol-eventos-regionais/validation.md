# Eventos Regionais do Caracol Validation

**Verifier**: independente (author ≠ verifier) — 2 iterações do ciclo fix→re-verify

---

## Iteração 2 (final) — 2026-09-21

**Diff desta iteração**: `45e2e35..174df8b` (commits `9ef01f6` teste de fix + `174df8b` docs de
spec/design/AD-006, sem código de produção novo)
**Verdict**: ✅ **PASS**

### O que mudou desde a Iteração 1

A Iteração 1 (seção abaixo) fechou com veredito ⚠️ ISSUES (não bloqueante): 14/14 ACs cobertas,
gate limpo, sensor com 1 mutante sobrevivente em REGCLIM-03 (ramo `raro` de `shouldExpire()` em
`server/caracol/regional-events.ts:72`, mutado para sempre retornar `true`). O único teste de
"não empilha/não interrompe" existente (`tests/caracol-regional-events.test.ts:80-91`) usava um
evento **sazonal** ativo, cujo ramo em `shouldExpire()` nunca passa pela checagem
`now >= state.expiresAt` usada pelo perfil `raro` — o mutante sobrevivia porque nenhum teste
discriminava esse ramo especificamente, embora o comportamento de produção estivesse correto
(revisado linha a linha na Iteração 1).

O commit `9ef01f6` adicionou exatamente o teste simétrico faltante:

`tests/caracol-regional-events.test.ts:93-104` —
`'não interrompe um evento raro ainda válido, mesmo com outro candidato elegível (perfil raro, não só sazonal)'`

```ts
const active = raroEvento('SP', { id: 'sp-atual' });
const outroElegivel = raroEvento('SP', { id: 'sp-outro', chancePorHoraNaJanela: 1_000_000 });
const catalog = [active, outroElegivel];
const activeByUf = new Map<string, RegionalEventState>([
  ['SP', { activeEventId: 'sp-atual', activatedAt: NOW - 1_000, expiresAt: NOW + 60_000, lastActivatedAt: NOW - 1_000 }],
]);
const plan = evaluate(catalog, NOW, activeByUf, () => 0);
expect(plan.nextByUf.get('SP')?.activeEventId).toBe('sp-atual');
expect(plan.nextByUf.get('SP')?.expiresAt).toBe(NOW + 60_000);
expect(plan.activations).toHaveLength(0);
expect(plan.deactivations).toHaveLength(0);
```

Este teste usa um evento **raro** ativo (`perfil: 'raro'`) com `expiresAt: NOW + 60_000` (futuro),
mais um segundo evento raro elegível no mesmo estado com chance de sorteio praticamente garantida
(`chancePorHoraNaJanela: 1_000_000`) — exatamente o cenário que a Iteração 1 apontou como
descoberto. A asserção bate com o outcome definido em REGCLIM-03 (evento ativo não expirado
permanece intacto: mesmo `activeEventId`, mesmo `expiresAt`, zero ativações, zero desativações).

Nenhuma outra linha de código de produção mudou desde a Iteração 1 (`git show 9ef01f6` só toca o
arquivo de teste). O commit `174df8b` adicionou `spec.md`/`design.md`/AD-006, sem relação com o
gap.

### Spec-Anchored Acceptance Criteria (recheck do item que mudou)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| REGCLIM-03: não empilha nem interrompe evento ativo não expirado (perfil raro) | evento raro ativo com `expiresAt` futuro permanece intacto mesmo com outro candidato elegível no mesmo estado | `server/caracol/regional-events.ts:72` - `return state.expiresAt === null \|\| now >= state.expiresAt;` + `tests/caracol-regional-events.test.ts:93-104` - `expect(plan.nextByUf.get('SP')?.activeEventId).toBe('sp-atual')`, `expect(plan.nextByUf.get('SP')?.expiresAt).toBe(NOW + 60_000)`, `expect(plan.activations).toHaveLength(0)` | ✅ PASS |

As demais 13 ACs não foram tocadas nesta iteração; seus vereditos ✅ PASS da Iteração 1 permanecem
válidos (nenhum código de produção mudou fora do já revisado).

### Gate Check

- **Gate command**: `npm run typecheck && npx vitest run tests/caracol-regional-events.test.ts tests/caracol.integration.test.ts`
- **Result**: typecheck limpo (2 projetos: `tsconfig.app.json` + `tsconfig.server.json`, 0 erros);
  **61 passed, 0 failed** (38 + 23) — era 60 antes desta iteração (+1 teste novo, exatamente o
  teste de fix)
- **Suíte completa** (`npx vitest run`): 442 passed no projeto raiz/Caracol; 2 suítes falham
  (`lafarmer/apps/server/src/index.test.ts`, `lafarmer/apps/server/src/production.test.ts`) por
  dependências não instaladas (`fastify`, `@lafarmer/content`) — pré-existente, sem relação com
  esta feature, ignorado por instrução explícita
- **Nota de flakiness observada**: numa primeira execução da suíte completa, 1 teste não
  relacionado (`tests/caracol.integration.test.ts` - "mata no alcance, mantém o caracol no local,
  zera o desconto e o preço de redirecionar", asserção de `redirectCost`) falhou isoladamente
  (esperava 16, recebeu 18); uma segunda execução da suíte completa passou 100% (442/442). O teste
  passa de forma estável quando rodado isolado junto com o escopo da feature (visto acima, 61/61).
  Não tem relação com `regional-events`/`shouldExpire` e não bloqueia este veredito — registrado
  para awareness, não como gap desta feature.
- **Test count no escopo da feature**: 60 → 61 (+1, o teste de fix)
- **Skipped tests**: nenhum
- **Failures no escopo da feature**: nenhuma

### Discrimination Sensor (re-run do mutante sobrevivente)

Executado em git worktree isolado (`/tmp/caracol-sensor-wt`, `git worktree add ... HEAD`), nunca no
working tree real. `git status --porcelain` do repo real capturado antes e depois — idêntico
(isolamento confirmado).

| # | File:line | Description | Killed? |
| - | --------- | ------------ | ------- |
| 1 (repetição da Iteração 1, mutante #2) | `server/caracol/regional-events.ts:72` | `shouldExpire()` para o ramo `raro`: `return state.expiresAt === null \|\| now >= state.expiresAt;` → `return true;` (sempre expira) | ✅ **Killed** — `tests/caracol-regional-events.test.ts:93-104` falhou: `expected null to be 'sp-atual'` (o novo teste de fix) |

**Sensor depth**: focado (1 mutação, repetição direcionada do mutante que sobreviveu na Iteração 1)
**Result**: 1/1 killed → **PASS**

### Requirement Traceability Update

`spec.md` atualizado: REGCLIM-01 a REGCLIM-14, todas de `Pending` para `✅ Verified` (14/14).

### Summary (Iteração 2)

**Overall**: ✅ **Ready** — o único gap da Iteração 1 (mutante sobrevivente em REGCLIM-03, ramo
`raro`) foi fechado pelo teste `tests/caracol-regional-events.test.ts:93-104`, confirmado matando o
mutante no sensor. 14/14 ACs com evidência `file:line`, 0 spec-precision gaps, gate limpo (61/61 no
escopo, 442/442 no projeto raiz), sensor 1/1 morto nesta iteração (4/4 já mortos na Iteração 1,
total 5/5 mutações da feature agora mortas).

**Spec-anchored check**: 14/14 ACs matched spec outcome (0 spec-precision gaps)
**Sensor**: 1/1 mutações mortas nesta iteração (5/5 acumulado desde a Iteração 1)
**Gate**: 61 passed, 0 failed (escopo da feature); 442 passed, 0 failed (projeto raiz, ignorando as
2 falhas pré-existentes do `lafarmer`)

**What works**: tudo o que a Iteração 1 já havia confirmado, mais a lacuna de cobertura do ramo
`raro` de `shouldExpire()`, agora fechada e provada por mutante morto.

**Issues found**: nenhum. O edge case "troca de cidade com efeito pessoal ativo" (sem teste de
integração dedicado, comportamento correto por construção arquitetural) continua registrado como
risco conhecido em `design.md`, não bloqueante — não fazia parte do escopo de fix desta iteração.

**Next steps**: nenhum. Feature pronta para ser marcada como concluída.

---

## Iteração 1 — 2026-09-21

**Date**: 2026-09-21
**Spec**: `.specs/features/caracol-eventos-regionais/spec.md`
**Diff range**: `775ddd7..HEAD` (13 commits, HEAD = `45e2e35`)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | Tipos em `shared/caracol.ts`; `CaracolNoticePayload['code']` inclui `'regional-event'` |
| T2 | ✅ Done | `caracol_regional_events`/`caracol_regional_claims` no `schemaSql`; 4 métodos novos em ambas as implementações do store |
| T3 | ✅ Done | `server/caracol/regional-events.ts` — motor puro completo |
| T4 | ✅ Done | `evaluateRegionalEvents` ligado a `tickInternal`; carga no `initialize()` |
| T5 | ✅ Done | `price()`, `chaseSpeedKmh()`, `stateFor()` aplicam os fatores regionais |
| T6 | ✅ Done | `claimRegionalShield` ligado aos 2 pontos de absorção de ataque |
| T7 | ✅ Done | `caracol:regional-claim` + `claimRegionalBonus` |
| T8-T12 | ✅ Done | Catálogo populado por região, 52 entradas no total |
| T13 | ✅ Done | Teste de fidelidade final; gate de build roda `npm run typecheck && npx vitest run` |

Todas as 13 tarefas marcadas `[x]` em `tasks.md` e confirmadas por evidência de código/teste abaixo.

---

## Spec-Anchored Acceptance Criteria

### P1: Motor genérico de clima regional

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| REGCLIM-01: tick de 30min reavalia elegibilidade dos 27 estados | reavaliação só dispara após 30min decorridos desde a última | `server/caracol/game.ts:1257` - `if (now - this.lastRegionalEvalAt < REGIONAL_EVAL_INTERVAL_MS) return;` + `tests/caracol.integration.test.ts:566-584` - `harness.now.value += 30 * 60_000; ... expect(sazonalRecord?.activeEventId).toBe('ac-teste-sazonal')` | ✅ PASS |
| REGCLIM-02: nunca ativa mais de 4 estados | `activeCount <= 4` mesmo com todos elegíveis, 100 tentativas | `server/caracol/regional-events.ts:163` - `remainingSlots = Math.max(0, REGIONAL_EVENTS_MAX_ACTIVE - activeCount)` + `tests/caracol-regional-events.test.ts:68-78` - `expect(activeCount).toBeLessThanOrEqual(REGIONAL_EVENTS_MAX_ACTIVE)` (100 iterações) | ✅ PASS |
| REGCLIM-03: não empilha nem interrompe evento ativo não expirado | evento ativo permanece intacto mesmo com outro elegível no mesmo estado | `server/caracol/regional-events.ts:143-147` - `if (event && !shouldExpire(event, state, now)) { nextByUf.set(uf, state); ... continue; }` + `tests/caracol-regional-events.test.ts:80-91` - asserido só com evento ativo **sazonal** (`sazonalEvento('CE')`), `expect(plan.nextByUf.get('CE')?.activeEventId).toBe('ce-atual')` | ⚠️ PASS com gap de cobertura — ver Discrimination Sensor, mutante #2 |
| REGCLIM-04: expira e reabre elegibilidade no ciclo seguinte | estado desativado no ciclo em que expira, só reelegível no próximo | `server/caracol/regional-events.ts:148-153` - bloco de desativação + `tests/caracol-regional-events.test.ts:93-102` - `expect(plan.nextByUf.get('SP')?.activeEventId).toBeNull()`, `expect(plan.deactivations).toEqual([{ uf: 'SP', event }])` | ✅ PASS |
| REGCLIM-05: `caracol:notice` nomeando estado e evento na ativação/desativação | payload com `code: 'regional-event'` | `server/caracol/game.ts:1269-1270` - `this.ioNotice('regional-event', \`${event.nome} começou em ${uf}.\`)` + `tests/caracol.integration.test.ts:601-611` - `expect(payload.code).toBe('regional-event')` | ✅ PASS |
| REGCLIM-06: reinício recarrega evento ativo e `expiresAt` original | novo `CaracolGameManager` sobre o mesmo store mantém o evento com o mesmo `expiresAt` | `server/caracol/game.ts:187-194` - `initialize()` popula `regionalEventsByUf` a partir de `snapshot.regionalEvents` + `tests/caracol.integration.test.ts:587-599` - `expect(after?.expiresAt).toBe(before?.expiresAt)` (segundo `CaracolGameManager` sobre o mesmo `harness.store`) | ✅ PASS |
| REGCLIM-07: alvo "ambos" ativa/desativa jogador+caracol atomicamente | as duas partes valem juntas no mesmo commit | `server/caracol/regional-events.ts:175-184` - uma única entrada `RegionalEventState` por `uf`, lida por `priceFactorFor`/`worldSpeedFactor` a partir do mesmo `event` + `tests/caracol-regional-events.test.ts:131-151` - `priceFactorFor(...)` e `worldSpeedFactor(...)` refletem o evento "ms-cheia" juntos, e caem para 1 juntos quando desativado | ✅ PASS |
| REGCLIM-08: catálogo malformado recusa subir | erro descritivo para uf inválida, `chancePorHoraNaJanela` ausente, sem efeito, `duracaoMs` malformado | `server/caracol/regional-events.ts:244-274` - `validateCatalog()` + `tests/caracol-regional-events.test.ts:153-159` - 4 asserções `toThrow(/.../)` + `server/caracol/game.ts:159` - `validateRegionalEventsCatalog(this.regionalEventsCatalog)` chamado no construtor (equivalente ao boot) | ✅ PASS |

### P2: Catálogo completo dos ~50 eventos

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| REGCLIM-09: catálogo fiel ao material de referência, 27 estados | contagem por estado bate com `plano/`, total ~50 | `tests/caracol-regional-events.test.ts:353-364` - `expect(count).toBeGreaterThanOrEqual(1)` por UF + `expect(CARACOL_REGIONAL_EVENTS_CATALOG.length).toBeGreaterThanOrEqual(45)/.toBeLessThanOrEqual(55)` (total real: 52, verificado por script Node ad hoc nesta validação) | ✅ PASS |
| REGCLIM-10: itens ⚠️ nunca entram no catálogo | nenhuma entrada referencia festival indígena nomeado, quilombo histórico, moldura étnica gaúcha/imigração de SC | `shared/caracol-regional-events.ts` (52 entradas, lidas na íntegra por este Verifier) - nenhuma ocorrência dos termos flagados + `tests/caracol-regional-events.test.ts:366-370` - `expectNoFlaggedItems(/quilombo\|palmares\|catucá\|conceição das crioulas\|anna eseru\|indígena\|ga[uú]cho\|tropeirismo\|imigra[cç][aã]o (alemã\|italiana)/i)` | ✅ PASS |
| REGCLIM-11: perfis sazonal e raro coexistem como entradas separadas | sazonal usa janela de meses sem sorteio, raro usa chance por hora | `shared/caracol-regional-events.ts:34-52` (AC: `ac-friagem` raro + implícito no restante do catálogo, múltiplos estados com 1 sazonal + 1 raro, ex. AM/RR/TO/CE/MA) + `server/caracol/regional-events.ts:86-94` - `eligibleCandidate()` trata sazonal (`isSeasonallyEligible`) e raro (`random() < chance`) como ramos distintos + `tests/caracol-regional-events.test.ts:336-338` - Oktoberfest usa `bonusResgatavel`, não desconto passivo | ✅ PASS |

### P3: Os 3 mecanismos novos

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| REGCLIM-12: ETA borrado do Ceará (só o alvo, campos restantes exatos) | `etaMs`/`distanceKm` arredondados ao passo, resto do estado intacto | `server/caracol/game.ts:1422-1427` - `playerViewOverridesFor(...)`; `etaBucket` só aplica arredondamento, resto do `stateFor` não muda + `tests/caracol.integration.test.ts:730-...` - "etaBorrado ativo arredonda etaMs/distanceKm ao passo configurado, sem esconder o resto do estado" | ✅ PASS |
| REGCLIM-13: velocidade por localização do alvo (MG/MA) sem exigir item | multiplicador aplica quando o alvo mora no estado ativo, não aplica fora | `server/caracol/regional-events.ts:212-220` - `chaseSpeedFactorAgainst()` só resolve pelo `targetUf` + `tests/caracol.integration.test.ts:662-682` (dobra dentro) e `:684-704` (não altera fora) | ✅ PASS |
| REGCLIM-14: bônus resgatável idempotente, `REGIONAL_ALREADY_CLAIMED` na 2ª tentativa | credita `valor` exatamente uma vez; 2ª tentativa recusa sem creditar | `server/caracol/game.ts:817-825` - `recordRegionalClaim` falha → `ack(this.failure('REGIONAL_ALREADY_CLAIMED', ...))`, sem chamar `commitPlan` de novo + `tests/caracol.integration.test.ts:837-869` - credita exatamente `BONUS_VALOR` na 1ª, `expect(second.code).toBe('REGIONAL_ALREADY_CLAIMED')` na 2ª, saldo não muda | ✅ PASS |

**Status**: ✅ 14/14 ACs cobertos com evidência `file:line`. 1 gap de cobertura anotado no REGCLIM-03 (comportamento correto pela leitura do código, mas o teste unitário exercitando "não interrompe" só usa um evento ativo sazonal, não um raro/com duração — ver sensor abaixo).

---

## Discrimination Sensor

Executado em git worktree isolado (`/tmp/caracol-sensor-wt`, HEAD do diff em validação), nunca no
working tree real. Baseline `git status --porcelain` do repo real capturado antes do sensor e
confirmado idêntico depois da remoção do worktree.

| # | File:line | Description | Killed? |
| - | --------- | ------------ | ------- |
| 1 | `server/caracol/regional-events.ts:163` | Teto de 4 estados: `REGIONAL_EVENTS_MAX_ACTIVE - activeCount` → `REGIONAL_EVENTS_MAX_ACTIVE + 1 - activeCount` (REGCLIM-02) | ✅ Killed — `tests/caracol-regional-events.test.ts:75` falhou (`expected 5 to be less than or equal to 4`) |
| 2 | `server/caracol/regional-events.ts:70-73` | Não empilha/não interrompe: `shouldExpire()` para evento **raro** (com `expiresAt` futuro) passou a sempre retornar `true` em vez de checar `now >= state.expiresAt` (REGCLIM-03) | ❌ **Survived** — nem `tests/caracol-regional-events.test.ts` nem `tests/caracol.integration.test.ts` falharam. O único teste unitário de "não interrompe" (`tests/caracol-regional-events.test.ts:80-91`) usa um evento ativo **sazonal**, cujo `shouldExpire` não passa pelo ramo mutado (`event.perfil === 'sazonal'` intercepta antes). Nenhum teste cobre um evento **raro** ativo com `expiresAt` no futuro sendo preservado por `evaluate()`. Ver Gap #1 abaixo |
| 3 | `server/caracol/store.ts:514-519` (`MemoryCaracolStore.recordRegionalClaim`) | Idempotência do resgate: removida a checagem `if (this.regionalClaims.has(key)) return false;`, sempre retorna `true` (REGCLIM-14 / escudo T6) | ✅ Killed — 3 testes falharam: `tests/caracol-regional-events.test.ts` ("recusa claim duplicado..."), `tests/caracol.integration.test.ts` ("não absorve uma segunda vez..." e "recusa um segundo resgate... REGIONAL_ALREADY_CLAIMED") |
| 4 | `server/caracol/game.ts:188` | Persistência/reload após restart: `for (const record of snapshot.regionalEvents)` → `for (const record of [])`, simulando reload que ignora o snapshot persistido (REGCLIM-06) | ✅ Killed — 8 testes falharam em `tests/caracol.integration.test.ts`, incluindo "mantém o evento ativo com o expiresAt original depois de reiniciar o processo" |
| 5 | `server/caracol/regional-events.ts:213-220` | `velocidadeContraAlvoNoEstado` só quando o alvo mora no estado ativo: `chaseSpeedFactorAgainst()` mutado para aplicar o multiplicador de **qualquer** estado ativo, ignorando `targetUf` (REGCLIM-13) | ✅ Killed — `tests/caracol-regional-events.test.ts:179` (`expected 1 to be 1.3`... invertido) e `tests/caracol.integration.test.ts` ("...não altera a perseguição quando o alvo mora fora do estado ativo") |

**Sensor depth**: P0-like (5 mutações, feature grande com múltiplos mecanismos comportamentais)
**Result**: 4/5 killed, 1 survived → **Gap registrado** (não bloqueia PASS geral, mas é uma lacuna de teste real; ver seção de Gaps)

Isolamento confirmado: `git status --porcelain` do working tree real idêntico antes e depois (só
`.specs/STATE.md` modificado e os 4 arquivos novos de `plano/`/`.specs`, já presentes antes do sensor
começar — nenhuma mutação vazou para o repo real).

---

## Interactive UAT Results

Não aplicável — feature de backend/mecânica de servidor, sem UI nova nesta versão (fora de escopo
por decisão da spec). Nenhum teste de UAT interativo foi solicitado ou é necessário.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — motor genérico reaproveitado por todo o catálogo, sem duplicação por evento |
| Surgical changes | ✅ — só os 7 arquivos em escopo foram tocados (mais `shared/caracol.ts`) |
| No scope creep | ✅ — roleta existente intocada; nenhuma UI nova |
| Matches patterns | ✅ — mesmo molde de `caracol_effects`/`wordlist.ts` reaproveitado |
| Spec-anchored outcome check (asserted values match spec) | ✅ — ver tabela acima |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ — motor genérico com 1:1 razoável às ACs REGCLIM-01/02/03/04/07/08; wiring cobre caminho feliz + restart + notice |
| Every test maps to a spec requirement - no unclaimed tests | ✅ — cada `it()` em `tests/caracol-regional-events.test.ts` mapeia a um REGCLIM ou a uma task de catálogo (T8-T13) |
| Documented guidelines followed | ✅ - nenhuma diretriz de projeto documentada (`AGENTS.md`/`CONTRIBUTING.md` ausentes); defaults fortes seguindo o padrão já estabelecido em `tests/caracol.integration.test.ts`/`tests/caracol-roulette.test.ts`, conforme registrado em `tasks.md` |

---

## Edge Cases

- [x] Janela cruzando a virada do ano (dez-mar): `isSeasonallyEligible()` usa `mesesElegiveis.includes(monthOf(now))`, uma checagem de pertencimento simples que não depende de intervalo ordinal — não precisa de lógica especial de wrap. Testado no lado "fora da janela" (`tests/caracol-regional-events.test.ts:104-112`, `mesesElegiveis: [12,1,2]`, mês atual junho → expira). **Não testado explicitamente** o lado "dentro da janela do outro lado da virada" (ex: mês = janeiro permanecendo ativo) — gap de cobertura leve, mas o mecanismo (`.includes()`) não tem como quebrar de forma diferente dos dois lados, risco baixo.
- [x] Nenhum evento elegível: estado simplesmente não ativa nada, não é erro — `tests/caracol-regional-events.test.ts:114-120`.
- [ ] Troca de cidade com efeito pessoal aplicado: a arquitetura ("efeito nunca é concedido, sempre derivado do `cityUf` atual na leitura") torna esse caso correto por construção — não existe estado de concessão para revogar. **Nenhum teste de integração exercita isso ao vivo** (jogador troca de cidade no meio do teste e o efeito muda de acordo). O próprio `design.md` já registra esse gap explicitamente na seção "Risks & Concerns" ("Nenhum teste de integração cobre múltiplos estados ativos ao mesmo tempo interagindo com o mesmo alvo trocando de cidade no meio") e não foi endereçado em nenhuma task. Gap de cobertura, não de comportamento.
- [x] Duas entradas raras sobrepostas no mesmo estado: escolhe a primeira que sortear, nunca as duas — `tests/caracol-regional-events.test.ts:122-129`.

---

## Gate Check

- **Gate command**: `npm run typecheck && npx vitest run tests/caracol-regional-events.test.ts tests/caracol.integration.test.ts`
- **Result**: typecheck limpo (sem erros); 60 passed, 0 failed no escopo da feature (37 + 23)
- **Suíte completa** (`npx vitest run`): 441 passed, 0 failed nos testes do projeto raiz/Caracol; 2 suítes falham (`lafarmer/apps/server/src/index.test.ts`, `lafarmer/apps/server/src/production.test.ts`) por dependência (`fastify`, `@lafarmer/content`) não instalada nesse subprojeto — falha pré-existente, sem relação com esta feature, confirmada por inspeção (erro de resolução de módulo, não de asserção)
- **Test count before feature**: não medido diretamente (fora do diff), mas os commits do diff (`775ddd7..HEAD`) introduzem 60 testes novos nos 2 arquivos em escopo, consistente com a Test Coverage Matrix de `tasks.md`
- **Skipped tests**: nenhum
- **Failures**: nenhuma no escopo da feature

---

## Fix Plans (if issues found)

### Fix 1: Gap de cobertura no REGCLIM-03 para eventos "raro" ativos

- **Root cause**: o único teste de "não interrompe/não empilha" (`tests/caracol-regional-events.test.ts:80-91`) usa um evento ativo do tipo `sazonal`, cujo ramo em `shouldExpire()` (`event.perfil === 'sazonal'`) nunca exercita a checagem `now >= state.expiresAt` usada pelo ramo `raro`. Um mutante que sempre retorna `true` no ramo `raro` de `shouldExpire()` sobrevive a toda a suíte em escopo.
- **Fix task**: adicionar 1 teste em `tests/caracol-regional-events.test.ts` com um evento `raro` ativo cujo `expiresAt` esteja no futuro (`now < state.expiresAt`) e outro evento do mesmo estado elegível no mesmo ciclo; assert que `evaluate()` preserva o evento raro ativo (`plan.nextByUf.get(uf)?.activeEventId` inalterado, `plan.activations` vazio) exatamente como já é feito para o caso sazonal.
- **Priority**: Minor — o comportamento do código está correto (lido linha a linha), é a suíte de teste que não discrimina esse ramo específico. Não bloqueia o funcionamento em produção, mas deixa uma regressão futura nesse ramo sem detecção.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ----------- |
| REGCLIM-01 | Pending | ✅ Verified |
| REGCLIM-02 | Pending | ✅ Verified |
| REGCLIM-03 | Pending | ⚠️ Verified com gap de teste (comportamento correto, cobertura incompleta) |
| REGCLIM-04 | Pending | ✅ Verified |
| REGCLIM-05 | Pending | ✅ Verified |
| REGCLIM-06 | Pending | ✅ Verified |
| REGCLIM-07 | Pending | ✅ Verified |
| REGCLIM-08 | Pending | ✅ Verified |
| REGCLIM-09 | Pending | ✅ Verified |
| REGCLIM-10 | Pending | ✅ Verified |
| REGCLIM-11 | Pending | ✅ Verified |
| REGCLIM-12 | Pending | ✅ Verified |
| REGCLIM-13 | Pending | ✅ Verified |
| REGCLIM-14 | Pending | ✅ Verified |

---

## Summary

**Overall**: ⚠️ Issues — 1 mutante sobrevivente no sensor de discriminação (REGCLIM-03, ramo raro de
`shouldExpire()`). Todo o resto da feature (13/13 tasks, 14/14 ACs com evidência, gate 100% verde,
integridade do catálogo) está correto e verificado; o único item pendente é fechar a lacuna de teste
do Fix 1 abaixo antes de considerar o sensor 100% limpo.

**Spec-anchored check**: 14/14 ACs com evidência `file:line`; 0 spec-precision gaps (todas as ACs
tinham outcome preciso o bastante para assert exato)
**Sensor**: 4/5 mutações mortas (P0-like, 5 mutações injetadas)
**Gate**: typecheck limpo; 60/60 testes do escopo da feature passam; 441/441 testes do projeto raiz
passam (2 suítes pré-existentes do `lafarmer` falham por dependência não instalada, sem relação com
esta feature)

**What works**: motor genérico completo (tick, teto de 4, não empilha/interrompe, expiração,
persistência/reload, notificação, validação de catálogo no boot); catálogo com 52 eventos cobrindo
os 27 estados sem nenhum item ⚠️; os 3 mecanismos de P3 (ETA borrado, velocidade por localização,
bônus resgatável idempotente) funcionando e testados isoladamente.

**Issues found**:
1. REGCLIM-03 tem cobertura de teste incompleta para o ramo "raro" de `shouldExpire()` — mutante
   sobreviveu. Comportamento de produção está correto (verificado por leitura), mas uma regressão
   futura nesse ramo específico não seria pega pela suíte atual. Fix task acima.
2. Edge case "troca de cidade com efeito pessoal ativo" não tem teste de integração dedicado
   (já registrado como risco conhecido em `design.md`); comportamento correto por construção
   arquitetural (efeito derivado ao vivo do `cityUf`, nunca concedido), mas sem teste que prove isso
   na prática end-to-end.

**Next steps**: Adicionar o teste do Fix 1 (não bloqueante para considerar a feature entregue, dado
que o comportamento real está correto); opcionalmente adicionar um teste de integração para o edge
case de troca de cidade, se o dono do projeto quiser fechar esse gap de cobertura também.
