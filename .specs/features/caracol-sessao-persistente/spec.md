# Sessão do Caracol Sobrevive a Restart Specification

## Problem Statement

`CaracolGameManager.sessions` mapeava `tokenHash → accountId` só em memória do processo Node,
nunca persistido nem recarregado a partir do snapshot de boot. Qualquer reinício do processo
(deploy, crash, ou o Render hibernando/acordando o serviço gratuito) zerava esse mapa inteiro:
o próximo `caracol:resume` de qualquer jogador com um token antes válido caía em
`SESSION_EXPIRED`, mesmo com a conta intacta no Postgres. Isso explicava os dois sintomas
relatados: sessão "expirando sozinha" e deploy deslogando todo mundo — mesma causa raiz.

## Goals

- [x] Sessão emitida por `caracol:register`/`caracol:login` continua válida depois de um
      reinício do processo, enquanto o mesmo armazenamento (Postgres) persistir.
- [x] Sessão revogada (logout ou substituída) continua inválida mesmo depois de um reinício.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| TTL/expiração automática de sessão | Fora do pedido do dono do projeto ("manter logado direto"); vira uma feature própria se decidido depois |
| Limite de sessões simultâneas por conta | Não relatado como problema; adicionar agora seria escopo não pedido |
| Revogar todas as sessões de uma conta ao logar em outro dispositivo | Mesmo motivo acima |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | --------------- | --------- | ---------- |
| "Restart do processo" em teste | Nova instância de `CaracolGameManager` + novo `Server`/`httpServer`, mesmo `CaracolStore` | Equivalente ao que acontece num deploy real: o processo Node morre e sobe de novo, o Postgres continua o mesmo | y |
| Sessão sem expiração automática | Token só morre em logout explícito ou substituição (`issueSession` revoga o anterior do mesmo socket) | Pedido explícito do dono ("quero ver se é possível manter logado direto"); jogo já não tem recuperação de senha, então adicionar TTL não muda o modelo de ameaça | y |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Sessão sobrevive a deploy/restart ⭐ MVP

**User Story**: Como jogador do Caracol, quero continuar logado depois que o servidor reinicia
(deploy, crash, ou hibernação do Render) para não precisar digitar nick e senha de novo toda vez.

**Why P1**: É o pedido direto do dono do projeto e a causa dos dois bugs relatados.

**Acceptance Criteria**:

1. WHEN um `sessionToken` foi emitido por `caracol:register` ou `caracol:login` AND o processo do
   servidor reinicia (nova instância de `CaracolGameManager` sobre o mesmo `CaracolStore`) AND um
   cliente emite `caracol:resume` com esse token THEN o servidor SHALL responder
   `{ ok: true, accountId, nickname }` referentes à mesma conta original.
2. WHEN uma sessão é emitida ou revogada THEN o armazenamento persistente SHALL guardar somente o
   hash SHA-256 do token (nunca o token em texto puro).

**Independent Test**: registrar conta, guardar `sessionToken`, criar um segundo `CaracolGameManager`
sobre o mesmo `MemoryCaracolStore` (simulando restart), conectar um novo socket e chamar
`caracol:resume` com o mesmo token — deve retornar `ok: true`.

---

### P2: Sessão revogada não ressuscita depois de um restart

**User Story**: Como dono do projeto, quero que um logout explícito continue efetivo mesmo depois
de um deploy, para que revogar acesso seja confiável.

**Why P2**: Consequência direta de persistir sessão — sem isso, "revogar" só valeria até o próximo
restart, o que reintroduziria parte do bug original de forma invertida.

**Acceptance Criteria**:

1. IF um `sessionToken` foi revogado (`caracol:logout`, ou substituído por `issueSession` no mesmo
   socket) THEN um `caracol:resume` subsequente com esse token SHALL responder `ok: false` com o
   código de falha `SESSION_EXPIRED`.

**Independent Test**: emitir sessão, fazer logout, tentar `caracol:resume` com o token antigo —
deve falhar com `SESSION_EXPIRED`.

---

## Edge Cases

- IF o token não existe em nenhuma sessão (nunca emitido, ou já expirado) THEN o servidor SHALL
  responder `ok: false` com `SESSION_EXPIRED` (comportamento pré-existente, não alterado).
- WHEN duas sessões diferentes (dois logins) da mesma conta coexistem THEN ambas SHALL continuar
  válidas depois de um restart (sessões são independentes por socket, não por conta).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --------------- | ----------- | ------ | ------- |
| CARSESS-01 | P1: Sessão sobrevive a deploy/restart | Implementing | Verified |
| CARSESS-02 | P1: Sessão sobrevive a deploy/restart (hash only) | Implementing | Verified |
| CARSESS-03 | P2: Sessão revogada não ressuscita | Implementing | Verified |

**ID format:** `CARSESS-NN`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 3 total, 3 mapped to tests, 0 unmapped

---

## Success Criteria

- [x] Registrar/login, matar o processo (novo manager sobre o mesmo store), `caracol:resume` com o
      token antigo continua funcionando.
- [x] Logout invalida o token mesmo depois de um restart subsequente.
