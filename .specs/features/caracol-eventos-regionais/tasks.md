# Eventos Regionais do Caracol Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with a `tlc-spec-driven` skill: **ative-a pelo nome e siga o fluxo de
Execute e as Critical Rules dela.** Não procure os arquivos do skill por caminho de sistema. O
skill é a fonte de verdade para o ciclo completo (por tarefa, delegação de sub-agente, Verifier,
sensor de discriminação).

**Se o skill não puder ser ativado, PARE e avise o usuário — não prossiga sem ele.**

---

**Design**: `.specs/features/caracol-eventos-regionais/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Gerada por amostragem do código e do spec — confirmar antes do Execute. Diretrizes encontradas:
> nenhuma (`AGENTS.md`/`CONTRIBUTING.md` não existem no projeto) — defaults fortes aplicados,
> calibrados pelo padrão já usado em `tests/caracol.integration.test.ts` (integração via
> Socket.IO/harness real) e `tests/caracol-roulette.test.ts` (manager testado direto, sem
> transporte, para lógica de domínio).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| Motor genérico (funções puras: `evaluate`, `priceFactorFor`, `worldSpeedFactor`, `chaseSpeedFactorAgainst`, `playerViewOverridesFor`, `validateCatalog`) — `server/caracol/regional-events.ts` | unit | Todos os ramos; 1:1 com REGCLIM-01/02/03/04/07/08; todo edge case listado na spec | `tests/caracol-regional-events.test.ts` | `npx vitest run tests/caracol-regional-events.test.ts` |
| Persistência (`caracol_regional_events`, `caracol_regional_claims`) — `server/caracol/store.ts` | integration | Round-trip de save/load nas duas implementações (`MemoryCaracolStore`, `PgCaracolStore` via smoke test que não exige Postgres real); tratamento de conflito de claim duplicado | `tests/caracol-regional-events.test.ts` | `npx vitest run tests/caracol-regional-events.test.ts` |
| Wiring do manager (tick, restart, notice, aplicação em `price`/`chaseSpeedKmh`/`stateFor`, resgate) — `server/caracol/game.ts` | integration | Todo fluxo em escopo: caminho feliz + os edge cases listados na spec (restart, virada de mês, troca de cidade, resgate duplicado) + erro | `tests/caracol.integration.test.ts` | `npx vitest run tests/caracol.integration.test.ts` |
| Catálogo de dados (`shared/caracol-regional-events.ts`, ~50 entradas) | unit | Contagem por estado/região bate com `plano/eventos-clima-proposta-completa.md`; nenhum item ⚠️ presente; passa `validateCatalog()` | `tests/caracol-regional-events.test.ts` | `npx vitest run tests/caracol-regional-events.test.ts` |
| Tipos (`shared/caracol.ts`, `shared/protocol.ts`) | none | build gate apenas | - | `npm run typecheck` |

## Gate Check Commands

> Gerado a partir do `package.json` do projeto — confirmar antes do Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tarefas só com teste unitário | `npx vitest run tests/caracol-regional-events.test.ts` |
| Full | Depois de tarefas com integração/wiring | `npx vitest run tests/caracol-regional-events.test.ts tests/caracol.integration.test.ts` |
| Build | Fim de fase, ou tarefa só de config/tipo | `npm run typecheck && npx vitest run` |

---

## Execution Plan

Fases em ordem; tarefas dentro de uma fase rodam em ordem.

### Phase 1: Fundação (tipos e persistência)

```
T1 → T2
```

### Phase 2: Motor genérico (P1 — REGCLIM-01 a 08)

```
T1 → T3
T2 → T4
T3 → T4
T4 → T5
```

### Phase 3: Ações únicas por ativação (escudo + resgate — REGCLIM-14)

```
T2 → T6
T4 → T6
T2 → T7
T4 → T7
T6 → T7
```

### Phase 4: Catálogo completo (P2 — REGCLIM-09 a 11)

```
T3 → T8
T3 → T9
T8 → T9
T3 → T10
T9 → T10
T3 → T11
T10 → T11
T3 → T12
T11 → T12
T12 → T13
```

---

## Task Breakdown

### T1: Tipos do evento regional e do aviso

**What**: Adicionar `CaracolRegionalEffect` (união discriminada dos 8 tipos de efeito) e
`CaracolRegionalEventDefinition` em `shared/caracol.ts`; estender o código de `CaracolNoticePayload`
em `shared/protocol.ts` com `'regional-event'`.
**Where**: `shared/caracol.ts`, `shared/protocol.ts`
**Depends on**: None
**Reuses**: Estilo dos tipos já existentes em `shared/caracol.ts` (`CaracolRouletteItem`, `CaracolEffectScope`)
**Requirement**: fundação para REGCLIM-01 a 14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `CaracolRegionalEffect` cobre os 8 `tipo` do design (`precoConta`, `saldoInstantaneo`, `escondeJogador`, `escudoContaCarga`, `etaBorrado`, `bonusResgatavel`, `velocidadeMundo`, `velocidadeContraAlvoNoEstado`) — `npx tsc --noEmit` resolve cada um nos usos de T3/T5
- [x] `CaracolNoticePayload['code']` aceita `'regional-event'` — `grep -n "'regional-event'" shared/caracol.ts` encontra a definição (SPEC_DEVIATION: `CaracolNoticePayload` vive em `shared/caracol.ts`, não `shared/protocol.ts` como a task descrevia; a extensão foi feita no arquivo real)
- [x] Sem erro de TypeScript: `npx tsc -p tsconfig.server.json --noEmit` sai com código 0

**Tests**: none
**Gate**: build

**Commit**: `feat(caracol): adiciona tipos de evento regional e novo código de aviso`

---

### T2: Schema e store dos eventos regionais

**What**: Adicionar `CREATE TABLE IF NOT EXISTS caracol_regional_events` e
`caracol_regional_claims` ao `schemaSql`; estender `CaracolStore` com
`loadRegionalEvents`/`saveRegionalEvents`/`recordRegionalClaim`/`hasRegionalClaim`; implementar nas
duas classes (`MemoryCaracolStore`, `PgCaracolStore`); estender `CaracolSnapshot` com
`regionalEvents: CaracolRegionalEventRecord[]`.
**Where**: `server/caracol/store.ts`
**Depends on**: T1
**Reuses**: Mesmo molde de `caracol_effects`/`caracol_push_subscriptions` (tabela + `CREATE TABLE
IF NOT EXISTS` + par Memory/Pg) já presente no arquivo

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `loadSnapshot()` das duas implementações devolve `regionalEvents` populado a partir do que foi salvo por `saveRegionalEvents` — round-trip testado em `tests/caracol-regional-events.test.ts` (SPEC_DEVIATION: só `MemoryCaracolStore` é exercitada por teste automatizado, como o resto do arquivo já faz para `PgCaracolStore`; sem Postgres real disponível no ambiente de execução, a implementação Pg segue o mesmo padrão de `saveWorld`/`writeAccount` já usado no arquivo e foi revisada por leitura)
- [x] `recordRegionalClaim` lançando/recusando quando a PK composta `(uf, activatedAt, accountId)` já existe — asserido em `tests/caracol-regional-events.test.ts`
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts`
- [x] Contagem de testes: pelo menos 4 testes novos (round-trip de evento, round-trip de claim, claim duplicado recusado, snapshot vazio inicial) — `npx vitest run tests/caracol-regional-events.test.ts` reporta 4+ nesse arquivo

**Tests**: integration
**Gate**: quick

**Commit**: `feat(caracol): schema e store dos eventos regionais`

---

### T3: Motor genérico do clima regional (funções puras)

**What**: Criar `server/caracol/regional-events.ts` com `evaluate()`, `priceFactorFor()`,
`worldSpeedFactor()`, `chaseSpeedFactorAgainst()`, `playerViewOverridesFor()` e `validateCatalog()`.
**Where**: `server/caracol/regional-events.ts`
**Depends on**: T1
**Reuses**: Padrão de "função pura + estado injetado" de `server/caracol/geo.ts`

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `evaluate()` nunca ativa mais de 4 estados ao mesmo tempo, mesmo com um catálogo de teste em que todos os 27 estariam elegíveis — REGCLIM-02, asserido em teste que roda `evaluate()` 100+ vezes e confere `activeCount <= 4` sempre
- [x] `evaluate()` não interrompe nem empilha um evento cuja duração ainda não expirou, mesmo quando outro evento do mesmo estado se torna elegível no meio-tempo — REGCLIM-03, teste dedicado
- [x] `evaluate()` expira um evento assim que sua duração (ou a virada do mês, para sazonal) passa, e o estado some da lista de ativos no ciclo seguinte — REGCLIM-04
- [x] `validateCatalog()` lança erro descritivo para: `uf` inválido, evento raro sem `chancePorHoraNaJanela`, evento sem `jogador` nem `caracol`, `duracaoMs` ausente num evento raro — 4 casos, um teste cada — REGCLIM-08
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts`
- [x] Contagem de testes: pelo menos 10 testes novos — `npx vitest run tests/caracol-regional-events.test.ts` reporta 10+ nesse arquivo (16 no total do arquivo, 12 novos desta task)

**Nota de design (não é desvio de spec):** `evaluate()`, `priceFactorFor()`, `worldSpeedFactor()`, `chaseSpeedFactorAgainst()` e `playerViewOverridesFor()` recebem o catálogo como primeiro parâmetro; o design.md omitiu esse parâmetro na assinatura, mas todas essas funções precisam resolver o `CaracolRegionalEventDefinition` a partir do `activeEventId` guardado em `RegionalEventState`, então o catálogo é uma dependência obrigatória, não uma adição de escopo. Também foi criado `shared/caracol-regional-events.ts` com `CARACOL_REGIONAL_EVENTS_CATALOG: []` (catálogo mínimo/vazio, conforme instruído) e `regionalEventsByUf()`, porque T4 (próxima task) precisa de um catálogo real para conectar ao manager, e T8-T13 (próximo lote) o populam.

**Tests**: unit
**Gate**: quick

**Commit**: `feat(caracol): motor genérico de eventos regionais`

---

### T4: Ligar o motor ao ciclo de vida do manager

**What**: Em `CaracolGameManager`, carregar `regionalEventsByUf` no `initialize()` a partir do
snapshot; chamar `evaluateRegionalEvents(now)` de dentro de `tickInternal()`, gated por 30 minutos
desde a última avaliação; persistir mudanças via `store.saveRegionalEvents`; transmitir
`caracol:notice` (`code: 'regional-event'`) quando um evento ativa ou desativa.
**Where**: `server/caracol/game.ts`
**Depends on**: T2, T3
**Reuses**: `tickInternal()`, `notify()`/`ioNotice()`, `CaracolCommit` já existentes

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Avançar o relógio controlado do teste em 30 minutos ativa/expira eventos de um catálogo de teste de 2-3 entradas — REGCLIM-01, testado em `tests/caracol.integration.test.ts` com `harness.now.value += ...` e `manager.tickOnce()`
- [x] Reiniciar o processo (novo `CaracolGameManager` sobre o mesmo store, mesmo padrão do teste de sessão) mantém o evento ativo com o `expiresAt` original — REGCLIM-06, teste dedicado
- [x] Um cliente conectado recebe `caracol:notice` com `code: 'regional-event'` ao ativar/desativar — `waitForEvent` no teste de integração confirma o payload
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts tests/caracol.integration.test.ts`
- [x] Contagem de testes: pelo menos 3 testes novos — `npx vitest run tests/caracol.integration.test.ts` reporta 3+ testes a mais que a contagem antes desta task (10 → 13)

**Nota de design:** `lastRegionalEvalAt` é inicializado no construtor com `this.clock()` (não com um valor "sempre vence"), para que a primeira avaliação regional real só rode 30 minutos depois do boot — mesma cadência de qualquer avaliação seguinte, e o que os testes de "avança 30 min" esperam. Isso não muda a garantia de persistência (REGCLIM-06): um evento já ativo nunca é tocado por uma nova avaliação a menos que expire de verdade (regra de não empilhar/não interromper do motor).

**Tests**: integration
**Gate**: full

**Commit**: `feat(caracol): motor regional ligado ao tick e à persistência`

---

### T5: Aplicar efeitos regionais em preço, velocidade e visão de estado

**What**: `price()` multiplica pelo fator de `priceFactorFor(account.cityUf, ...)`;
`chaseSpeedKmh()` multiplica por `worldSpeedFactor()` e, quando `target.cityUf` tem um evento
`velocidadeContraAlvoNoEstado` ativo, pelo fator correspondente; `stateFor()` faz `hidden` também
considerar `escondeJogador`, e arredonda `etaMs`/`distanceKm` quando `etaBorrado` está ativo para o
estado da conta.
**Where**: `server/caracol/game.ts`
**Depends on**: T4
**Reuses**: `price()`, `chaseSpeedKmh()`, `stateFor()` já existentes; mesmo padrão de composição de
fatores já usado por `coin`/`lightning`

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Um evento `precoConta` ativo no estado da conta muda o valor de `redirectCost`/`speedCost` exibido — REGCLIM-07 (efeito jogador), teste em `tests/caracol.integration.test.ts` compara custo com e sem o evento ativo
- [x] Um evento `velocidadeMundo` ativo muda a velocidade de perseguição contra qualquer alvo, e um `velocidadeContraAlvoNoEstado` só muda quando o alvo atual mora no estado ativo — REGCLIM-13, dois testes distintos (mais um terceiro que confirma que fora do estado o fator não se aplica)
- [x] Um evento `escondeJogador` ativo faz `hidden: true` no `stateFor` da conta, mesmo sem Blooper — teste dedicado
- [x] Um evento `etaBorrado` ativo faz `etaMs`/`distanceKm` virarem um valor arredondado ao passo configurado, não o valor exato — REGCLIM-12, teste dedicado
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts tests/caracol.integration.test.ts`
- [x] Contagem de testes: pelo menos 4 testes novos — `npx vitest run tests/caracol.integration.test.ts` reporta 6 testes a mais que a contagem antes desta task (13 → 19)

**Tests**: integration
**Gate**: full

**Commit**: `feat(caracol): eventos regionais afetam preço, velocidade e visão de estado`

---

### T6: Escudo de carga regional (ação única, passiva)

**What**: Nos pontos onde o jogo já checa `activeEffect(target.id, 'shield', now)` para absorver um
ataque (redirect/bumerangue), passar também a considerar um evento `escudoContaCarga` ativo no
estado da conta-alvo, sem `caracol_regional_claims` ainda usado para essa ocorrência, como
equivalente a ter escudo; ao absorver, gravar a claim (`recordRegionalClaim`) para essa ocorrência,
consumindo-o.
**Where**: `server/caracol/game.ts`
**Depends on**: T2, T4
**Reuses**: `absorbAttack()`/checagens de `shield` já existentes (`server/caracol/game.ts:415`, `:687`)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Uma conta no estado com `escudoContaCarga` ativo e sem claim registrada para a ativação absorve o próximo ataque, e uma claim é gravada no mesmo commit do absorvimento — teste dedicado em `tests/caracol.integration.test.ts` (nota: a claim é gravada em `caracol_regional_claims`, tabela separada de `caracol_commit`; "mesmo commit" aqui é "mesma ação serializada pela fila de mutação", não a mesma transação SQL — ver comentário `ponytail:` em `claimRegionalShield`)
- [x] Uma segunda tentativa de ataque na mesma ativação (claim já gravada) não é mais absorvida pelo evento regional (só por um Casco defensivo de item, se houver) — asserido em `tests/caracol.integration.test.ts`, teste "não absorve duas vezes na mesma ativação"
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts tests/caracol.integration.test.ts`
- [x] Contagem de testes: pelo menos 2 testes novos — `npx vitest run tests/caracol.integration.test.ts` reporta 2 testes a mais que a contagem antes desta task (19 → 21)

**Tests**: integration
**Gate**: full

**Commit**: `feat(caracol): escudo de carga dos eventos regionais`

---

### T7: Bônus resgatável (ação única, disparada pelo jogador)

**What**: Novo evento `caracol:regional-claim` (client→server, sem payload) em
`shared/protocol.ts`; handler em `CaracolGameManager` (via `enqueueMutation`) que credita o
`valor` de um evento `bonusResgatavel` ativo no estado da conta, uma vez por ativação; segunda
tentativa na mesma ativação falha com `REGIONAL_ALREADY_CLAIMED` sem creditar de novo.
**Where**: `shared/protocol.ts`, `server/caracol/game.ts`
**Depends on**: T2, T4, T6
**Reuses**: `enqueueMutation()`, `CaracolCommit`, mesmo padrão de handler de `caracol:roulette`

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Resgatar um `bonusResgatavel` ativo credita exatamente `valor` moedas uma vez — REGCLIM-14, teste dedicado
- [x] Uma segunda chamada de `caracol:regional-claim` na mesma ativação responde `ok: false, code: 'REGIONAL_ALREADY_CLAIMED'` e não altera o saldo — REGCLIM-14, teste dedicado
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts tests/caracol.integration.test.ts`
- [x] Contagem de testes: pelo menos 2 testes novos — `npx vitest run tests/caracol.integration.test.ts` reporta 2 testes a mais que a contagem antes desta task (21 → 23)

**Tests**: integration
**Gate**: full

**Commit**: `feat(caracol): bônus resgatável dos eventos regionais`

---

### T8: Catálogo — Região Norte (7 estados)

**What**: Popular `shared/caracol-regional-events.ts` com os eventos de AC, AM, AP, PA, RO, RR, TO
descritos em `plano/eventos-clima-proposta-completa.md`.
**Where**: `shared/caracol-regional-events.ts`
**Depends on**: T3
**Reuses**: `validateCatalog()` (T3) para autoconferir a entrada assim que escrita

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `validateCatalog(CARACOL_REGIONAL_EVENTS_CATALOG)` não lança erro depois da região adicionada
- [x] Contagem de entradas para cada um dos 7 estados bate com a tabela do documento de referência — `tests/caracol-regional-events.test.ts` conta por `uf`
- [x] Nenhuma entrada usa um item marcado ⚠️ no documento de referência (Roraima: nada do Festival Indígena Anna Eseru) — checado por busca textual (`grep -i "anna eseru\|indígena" shared/caracol-regional-events.ts` não encontra nada)
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(caracol): catálogo de eventos regionais — Região Norte`

---

### T9: Catálogo — Região Nordeste (9 estados)

**What**: Popular o catálogo com os eventos de AL, BA, CE, MA, PB, PE, PI, RN, SE.
**Where**: `shared/caracol-regional-events.ts`
**Depends on**: T3, T8
**Reuses**: mesmo de T8

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `validateCatalog()` não lança erro depois da região adicionada
- [x] Contagem de entradas por estado bate com o documento de referência — asserido em `tests/caracol-regional-events.test.ts`, comparando `CARACOL_REGIONAL_EVENTS_CATALOG.filter(e => e.uf === uf).length` contra a tabela do documento, para os 9 estados
- [x] Nenhuma entrada usa item ⚠️ (Alagoas/Pernambuco: nada do Quilombo de Palmares/Catucá/Conceição das Crioulas; Ceará: nada dos povos indígenas nomeados) — checado por busca textual (`grep -i "quilombo\|indígena" shared/caracol-regional-events.ts` não encontra nada)
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(caracol): catálogo de eventos regionais — Região Nordeste`

---

### T10: Catálogo — Região Centro-Oeste (4 estados/DF)

**What**: Popular o catálogo com os eventos de GO, MT, MS, DF.
**Where**: `shared/caracol-regional-events.ts`
**Depends on**: T3, T9
**Reuses**: mesmo de T8

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `validateCatalog()` não lança erro depois da região adicionada
- [x] Contagem de entradas por estado bate com o documento de referência — asserido em `tests/caracol-regional-events.test.ts`, comparando `CARACOL_REGIONAL_EVENTS_CATALOG.filter(e => e.uf === uf).length` contra a tabela do documento, para os estados desta região
- [x] O evento "ambos" do Mato Grosso do Sul (Cheia do Pantanal) tem tanto `jogador` quanto `caracol` definidos
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(caracol): catálogo de eventos regionais — Centro-Oeste`

---

### T11: Catálogo — Região Sudeste (4 estados)

**What**: Popular o catálogo com os eventos de ES, MG, RJ, SP.
**Where**: `shared/caracol-regional-events.ts`
**Depends on**: T3, T10
**Reuses**: mesmo de T8

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `validateCatalog()` não lança erro depois da região adicionada
- [x] Contagem de entradas por estado bate com o documento de referência — asserido em `tests/caracol-regional-events.test.ts`, comparando `CARACOL_REGIONAL_EVENTS_CATALOG.filter(e => e.uf === uf).length` contra a tabela do documento, para os estados desta região
- [x] Os eventos de MG (ZCAS) e RJ (Temporal de Verão) usam `velocidadeContraAlvoNoEstado`, não `velocidadeMundo`, conforme documentado
- [x] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(caracol): catálogo de eventos regionais — Região Sudeste`

---

### T12: Catálogo — Região Sul (3 estados)

**What**: Popular o catálogo com os eventos de PR, RS, SC, incluindo o bônus resgatável da
Oktoberfest (SC) e o escudo do Círio de Nazaré (esse é PA, já coberto em T8 — conferir que não
duplica).
**Where**: `shared/caracol-regional-events.ts`
**Depends on**: T3, T11
**Reuses**: mesmo de T8

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `validateCatalog()` não lança erro depois da região adicionada
- [ ] Contagem de entradas por estado bate com o documento de referência — asserido em `tests/caracol-regional-events.test.ts`, comparando `CARACOL_REGIONAL_EVENTS_CATALOG.filter(e => e.uf === uf).length` contra a tabela do documento, para os estados desta região
- [ ] A entrada da Oktoberfest usa `tipo: 'bonusResgatavel'`, não um desconto passivo — REGCLIM-11
- [ ] Nenhuma entrada usa a moldura étnica ⚠️ de "cultura gaúcha"/imigração de SC — checado por busca textual (`grep -i "gaúcho\|tropeirismo\|imigração alemã\|imigração italiana" shared/caracol-regional-events.ts` não encontra nada fora de nomes de prato/festa já aprovados)
- [ ] Gate check passa: `npx vitest run tests/caracol-regional-events.test.ts`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(caracol): catálogo de eventos regionais — Região Sul`

---

### T13: Fidelidade final do catálogo (27 estados, ~50 eventos)

**What**: Teste que soma as entradas dos 27 estados e confere contra a tabela consolidada de
`plano/eventos-clima-proposta-completa.md`; confirma que todo estado tem pelo menos 1 evento;
confirma ausência total de itens ⚠️ no catálogo inteiro.
**Where**: `tests/caracol-regional-events.test.ts`
**Depends on**: T12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Todos os 27 estados (26 + DF) têm pelo menos 1 entrada no catálogo — REGCLIM-09, asserido iterando `brazilianCities` UFs únicas contra `CARACOL_REGIONAL_EVENTS_CATALOG` em `tests/caracol-regional-events.test.ts`
- [ ] A contagem total de entradas está entre 45 e 55 (a proposta é "~50", não um número exato) — REGCLIM-09, `expect(CARACOL_REGIONAL_EVENTS_CATALOG.length).toBeGreaterThanOrEqual(45)` e `.toBeLessThanOrEqual(55)` em `tests/caracol-regional-events.test.ts`
- [ ] Nenhuma entrada de nenhuma região referencia os itens marcados ⚠️ no material de referência — REGCLIM-10, `grep -iE "quilombo|indígena|anna eseru|gaúcho|tropeirismo|imigração (alemã|italiana)" shared/caracol-regional-events.ts` não encontra nada, checado em `tests/caracol-regional-events.test.ts`
- [ ] Gate check passa: `npm run typecheck && npx vitest run` (gate de build, fecha a feature)

**Tests**: unit
**Gate**: build

**Commit**: `test(caracol): fidelidade do catálogo completo de eventos regionais`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ------→ T2
Phase 2:  T3 ------→ T4 ------→ T5
Phase 3:  T6 ------→ T7
Phase 4:  T8 ------→ T9 ------→ T10 ------→ T11 ------→ T12 ------→ T13
```

Execução estritamente sequencial — sem paralelismo intra-fase.

**Empacotamento sugerido (~7 tarefas/lote)**: 13 tarefas ao todo, mais que o limite de execução
inline (~8). Fases 1+2+3 somam 7 tarefas (lote 1); Fase 4 sozinha soma 6 (lote 2) — um corte natural
de fase, sem quebrar nenhuma fase ao meio.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Tipos | 2 arquivos de tipo, sem lógica | ✅ Granular |
| T2: Schema e store | 1 arquivo, 2 tabelas + 4 métodos coesos | ✅ Granular (coeso) |
| T3: Motor genérico | 1 arquivo novo, 6 funções coesas de um único módulo | ✅ Granular (coeso) |
| T4: Wiring do tick | 1 arquivo, 1 ponto de integração (tick + boot + notice) | ✅ Granular |
| T5: Aplicação em price/chase/state | 1 arquivo, 3 funções já existentes, mesma mudança conceitual | ✅ Granular (coeso) |
| T6: Escudo de carga | 1 arquivo, pontos de checagem de shield já existentes | ✅ Granular |
| T7: Bônus resgatável | 2 arquivos (protocolo + handler), 1 conceito | ✅ Granular (coeso) |
| T8-T12: Catálogo por região | 1 arquivo, dado de uma região por vez | ✅ Granular |
| T13: Fidelidade final | 1 arquivo de teste | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | (nenhuma seta de entrada) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | (T1 → T3 implícito na fase 2 depender da 1; setas dentro da fase mostradas como T3→T4→T5) | ✅ Match |
| T4 | T2, T3 | T3 → T4 (T2 cruza fase, coberto pela ordem sequencial de fases) | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T2, T4 | T6 início da fase 3, depende de artefatos das fases 1-2 já concluídas | ✅ Match |
| T7 | T2, T4 | T6 → T7 | ✅ Match |
| T8 | T3 | T8 início da fase 4 | ✅ Match |
| T9 | T3 | T8 → T9 | ✅ Match |
| T10 | T3 | T9 → T10 | ✅ Match |
| T11 | T3 | T10 → T11 | ✅ Match |
| T12 | T3 | T11 → T12 | ✅ Match |
| T13 | T8, T9, T10, T11, T12 | T12 → T13 | ✅ Match |

Nenhuma dependência aponta para uma fase posterior.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | ----------------------------- | ---------------- | ---------- | ------ |
| T1 | Tipos | none | none | ✅ OK |
| T2 | Persistência | integration | integration | ✅ OK |
| T3 | Motor genérico (domínio) | unit | unit | ✅ OK |
| T4 | Wiring do manager | integration | integration | ✅ OK |
| T5 | Wiring do manager | integration | integration | ✅ OK |
| T6 | Wiring do manager | integration | integration | ✅ OK |
| T7 | Wiring do manager | integration | integration | ✅ OK |
| T8-T12 | Catálogo de dados | unit | unit | ✅ OK |
| T13 | Catálogo de dados (fidelidade) | unit | unit | ✅ OK |

---

## Tips

(seção de referência do template, sem conteúdo específico desta feature)
