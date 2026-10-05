# Vila dos Agentes Connector Onboarding Design

**Spec:** `.specs/features/agent-village-connector/spec.md`
**Status:** Approved within the current implementation scope

## Architecture Overview

O servidor mantém `pairings` no mesmo JSON da vila. `POST /api/pairings` exige cookie do morador, cria um robô pendente e devolve apenas código/expiração. O comando de shell baixa um instalador Node por HTTPS e envia o código para `POST /api/pairings/exchange`; essa rota não exige cookie, mas aceita somente o código de uso único. A troca materializa o token do robô e configura hooks locais.

O instalador baixa um coletor imutável do mesmo domínio. O coletor lê cada evento do hook em `stdin`, aplica allowlist por provedor, incrementa sequência sob lock e envia `POST /api/events`. O servidor normaliza novamente, vincula a primeira sessão pendente e aplica o reducer existente.

```text
Browser autenticado
  └─ POST /api/pairings ──> pairing hash + robô pending
                               │ código temporário
PowerShell / Git Bash / zsh
  └─ installer.mjs ──> POST /api/pairings/exchange
                          │ token único
                          └─ hooks.json/settings.json + collector.mjs
Codex / Claude hook ──> collector allowlist ──> POST /api/events
                                               └─ reducer + vila
```

## Components

| Component | Location | Interface |
| --- | --- | --- |
| Pairing state | `server/village.mjs` | `createPairing`, `exchangePairing`, pending session binding |
| Pairing routes | `server/http.mjs` | `POST /api/pairings`, `POST /api/pairings/exchange` |
| Shell/installer assets | `server/connector/`, `server/http.mjs` | `GET /install.ps1`, `GET /install.sh`, `GET /connector/install.mjs`, `GET /connector/collector.mjs` |
| Browser wizard | `web/main.ts`, `web/types.ts`, `web/styles.css` | provider/shell selection, command copy, pairing status |
| Server tests | `tests/village.test.mjs`, `tests/http.test.mjs` | expiry, one-use, binding, privacy |
| Connector tests | `tests/connector.test.mjs` | allowlist, sequence lock, hook merge and uninstall |

## Data Model

Existing robot gains `pairingId` (private), nullable `sessionId` while pending and `provisioned` boolean. State gains `pairings: [{id, robotId, ownerId, provider, pairingHash, expiresAt}]`. Pairing hashes and temporary connector hashes are persisted; raw pairing codes and raw robot tokens are never persisted.

## Security and Failure Strategy

- Pairing codes are hashed with the existing SHA-256 helper, expire after ten minutes and are removed after exchange.
- A pending robot cannot ingest until its connector token is materialized; after the first accepted event its provider/session binding is immutable.
- The installer refuses malformed existing JSON and writes temporary files followed by rename.
- Hook commands use a three-second network timeout and suppress stdout; failures go to local stderr without payloads.
- The server keeps `/api/events` token ownership, sequence ordering, payload bounds and public allowlist unchanged.

## Browser State

`lastPairing` stores only pairing id, code, provider, label, selected shell and expiry. The UI polls `/api/me` and `/api/village`; it derives “Aguardando instalação” from `status=pending`, “Aguardando primeiro sinal” from provisioned idle with null session, and connected activity from the existing status reducer. Copying the command uses the Clipboard API with a text fallback.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing hook JSON has invalid syntax | Installer stops before writing and prints the path; no overwrite. |
| Two hook invocations race the sequence file | Lock file with bounded retry and atomic rename. |
| Code leaks through shell history | Code is short-lived, one-use, and never equals the permanent token. |
| User closes browser after creating pairing | Pending robot remains visible until expiry; command can finish independently. |
| Provider emits unsupported event | Collector drops it locally; no private payload reaches HML. |
