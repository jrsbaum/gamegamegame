# Vila dos Agentes Design

**Spec:** `.specs/features/agent-village/spec.md`
**Status:** Approved within delegated implementation scope

## Architecture Overview

Um app workspace raiz com cliente TypeScript/Vite/Three.js e servidor Node HTTP. O servidor autentica contas, mantém uma vila compartilhada e fornece snapshots a cada 3 segundos. Cada coletor usa token exclusivo do robô. Apenas a projeção pública sai no snapshot dos amigos; o dono recebe configurações próprias em endpoint distinto. JSON persistido por transação serial, escrita temporária e rename. Uma única réplica é obrigatória.

Alternativas consideradas: PostgreSQL adiciona serviço e migrações antes da necessidade; memória perde contas e mesas em deploy. O arquivo persistido mantém o MVP simples e durável, com limite explícito de uma réplica.

## Code Reuse Analysis

| Component | Location | How to Use |
| --- | --- | --- |
| Adaptador/reducer/demo | Ensaio village-events.mjs | Copiar e adaptar; adicionar reading, bounds e sequência no service |
| Cenário Three.js | Ensaio eventos-na-vila.html | Reaproveitar geometria/cores em módulo tipado dinâmico |
| Catálogo e contratos | packages/game-catalog e platform-contracts | Adicionar ID/domínios sem integrar autenticação |
| Deploy Vite/Node22 | infra/docker | Um container próprio serve UI e API na mesma origem |

## Components

| Component | Location | Interfaces |
| --- | --- | --- |
| Reducer de eventos | server/events.mjs | normalizeEvent, applyEvent, publicRobot |
| Store/vila | server/village.mjs | transact, register, login, authenticate, createRobot, ingest, snapshot |
| Gateway HTTP | server/http.mjs | createVillageServer; cookies, origin, bounds e respostas |
| Mundo 3D | web/world.ts | setSnapshot, setView, select, dispose |
| Cliente | web/main.ts | Demo separada, auth, mesas, robôs, polling |
| Distribuição | infra/dokploy/agent-village | Compose parametrizado por domínio/ambiente/volume |

## Data Models

Conta: id, username, displayName, passwordHash, salt, deskSize. Sessão browser: tokenHash, accountId, expiresAt. Robô: id, ownerId, provider, sessionId, label, privacy, title, description, connectorHash, status, tools, runId, sequence. Presença é efêmera por accountId, fora do arquivo. Raw events nunca são persistidos.

## Error Handling Strategy

400 entrada inválida; 401 credencial inválida; 403 convite/origem; 404 recurso de outro dono; 409 duplicata/limite; 413 corpo excessivo; 429 autenticação limitada; 503 gravação falhou. Erros não refletem payload nem logs de credenciais. Arquivo corrompido impede startup.

## Risks & Concerns

| Concern | Location | Impact | Mitigation |
| --- | --- | --- | --- |
| Duas réplicas sobrescrevem arquivo | novo store | perda de estado | Compose uma réplica; README bloqueia escala horizontal |
| Metadados vazam por projeção cliente | ensaio publicRobot | exposição de tarefas | projeção allowlist no servidor e testes de JSON recebido por outro dono |
| Eventos antigos retornam estado terminal | ensaio applyEvent | robô errado/estado incorreto | sequence obrigatório por token e runId guard; tokens novos reiniciam sequência |
| main contém trabalho fora da missão | git baseline | promoção acidental | commits explícitos e cherry-pick isolado para staging na etapa de deploy |
| Falta GPU no browser | novo world | cenário indisponível | fallback mantém toda ação na interface HTML |

## Tech Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Armazenamento | JSON atômico, uma réplica, limite de 100 contas | Grupo pequeno; sem dados de outros jogos |
| Fronteira do coletor | Token por robô, só POST events | Revogação granular e nenhum poder de editar privacidade |
| Renderização | Three 0.170 local no bundle | Versão já usada no repo/ensaio; nada depende de CDN em runtime |
| Visual | Verde folha #486940, grama #bbdcb5, mel #dda94f, lago #75b7ba, cereja #d78576, papel #fff9e9 | Paleta do ensaio; tipografia Trebuchet display e Segoe UI body sem carregamento externo |
| Assinatura visual | Casinha cortada que se abre no mesmo diorama ao entrar no escritório | O mundo ocupa a tela principal, os controles ficam como caderninho lateral |

O desenho evita cartões de métricas e usa o próprio diorama como ponto de entrada. Animação comunica trabalho/leitura/espera, com reduced motion. Lista acessível replica seleção do mundo, sem depender de canvas.
