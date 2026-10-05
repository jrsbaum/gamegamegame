# Vila dos Agentes: conexões e robôs auto-spawn

**Spec:** `.specs/features/agent-village-auto-spawn/spec.md`  
**Status:** Draft

## Architecture Overview

O serviço mantém uma credencial de coletor por conexão e cria sessões visuais sob demanda. O token autentica a instalação/harness; o `sessionId` identifica a instância de agente. A ingestão resolve a conexão pelo hash do token, valida o evento, encontra ou cria o robô por chave composta e aplica o reducer existente. A projeção pública continua separada da visão do dono.

```text
pairing exchange
      │
      ▼
connection(tokenHash, provider, defaults)
      │ collector sends events
      ▼
resolve(connectionId, sessionId)
   ┌──┴──────────────┐
   ▼                 ▼
robot(session-A)  robot(session-B, parent=A)
   │                 │
   └──── public projection / notebook / bubble
```

## Components

| Component | Location | Change |
| --- | --- | --- |
| Event normalization/reducer | `apps/agent-village/server/events.mjs` | Transportar parent/session lifecycle e manter estados independentes |
| Connection/session store | `apps/agent-village/server/village.mjs` | Separar token de conexão, lazy spawn, lookup composto, migração |
| HTTP gateway | `apps/agent-village/server/http.mjs` | Endpoints de conexão/defaults e compatibilidade dos endpoints existentes |
| Connector | `apps/agent-village/server/connector/` | Um collector por conexão, eventos de várias sessões, campos opcionais de spawn |
| Client model/UI | `apps/agent-village/web/` | Conexões como controle criado; robôs agrupados e descobertos automaticamente |
| Persistence fixtures | `apps/agent-village/tests/` | Testar simultaneidade, idempotência, privacy e fixtures legadas |

## Data Models

```text
Connection
- id, ownerId, provider
- connectorHash, defaultPrivacy
- label, createdAt, lastSignalAt

RobotSession
- id, ownerId, connectionId, provider
- sessionId, parentSessionId?
- label, privacy, status
- title, description, runId, tools
- sequence/lastEventSequence, lastSignalAt
```

Durante a transição, registros antigos de `robots` podem receber uma conexão implícita ou continuar com seu token individual. A leitura deve aceitar ambos os formatos; novos pairings usam o modelo de conexão.

## Event Contract

O collector mantém `sequence` por conexão e envia:

```json
{
  "sequence": 42,
  "event": {
    "session_id": "sessao-do-harness",
    "parent_session_id": "sessao-pai-opcional",
    "hook_event_name": "UserPromptSubmit",
    "title": "Resumo sanitizado",
    "description": "Contexto sanitizado"
  }
}
```

O servidor não confia no parent para autorização: ele serve apenas para árvore visual, é limitado e nunca sai na projeção pública. Eventos sem `parent_session_id` continuam válidos.

## State Transitions

```text
unknown ──first accepted event──► idle/working/reading/tool
active ──new event──────────────► active state
active ──SessionEnd/terminal────► completed
completed ──late event──────────► rejected
```

Criação e aplicação do primeiro evento precisam ocorrer dentro da mesma transação serial do store. Assim, duas requisições concorrentes não geram dois robôs.

## API Surface

- Pairing exchange passa a retornar `connection` + token; o response pode incluir uma referência inicial, mas não uma instância criada.
- `POST /api/events` autentica pelo token da conexão e resolve sessões dinamicamente.
- `GET/PATCH /api/connections` expõe ao dono provider, label e default de privacidade sem token bruto.
- Endpoints antigos de robô permanecem para leitura/edição de legados durante a migração; o cliente novo não os usa para criar instâncias.
- `GET /ws` aceita o cookie de sessão da mesma origem, envia `hello` com o snapshot inicial, responde `snapshot.get` e transmite `snapshot` quando um evento aceito altera a vila. O navegador reconecta e usa polling HTTP apenas como fallback.

## Security and Privacy

- Hashes de token permanecem no arquivo; token bruto só é retornado no exchange/rotação.
- Cada evento precisa de token válido, provider compatível, sessionId bounded e sequência válida.
- A instância nunca é encontrada somente por sessionId global; a conexão é parte da chave.
- `publicRobot` continua removendo connectionId, sessionId, parentSessionId, prompts, tokens e eventos.
- Defaults e alterações de privacidade só podem ser feitos pelo dono da conexão/robô.

## Failure Handling

- Auto-spawn que falhar ao persistir retorna erro sem deixar instância fantasma.
- Reenvio da mesma sequência retorna `accepted=false` e não duplica robô.
- Token revogado impede criação/atualização de qualquer sessão da conexão.
- Sessões sem `SessionStart` são criadas no primeiro evento válido; ausência de parent não é erro.

## Risks and Mitigations

| Concern | Impact | Mitigation |
| --- | --- | --- |
| Hooks globais enviam eventos de vários chats | Um collector pode receber sessões diferentes | Lookup composto por conexão + sessionId e testes de isolamento |
| Corridas no primeiro evento | Robô duplicado | Transação serial + teste concorrente |
| Provider não informa spawn | Árvore incompleta | Spawn por sessionId e parent opcional |
| Fixture antiga sem connectionId | Upgrade quebra HML | Caminho de leitura/migração legado |
| Crescimento de arquivo | Snapshots mais pesados | Sem TTL nesta feature; deixar limite/arquivamento explícito para tarefa posterior |
