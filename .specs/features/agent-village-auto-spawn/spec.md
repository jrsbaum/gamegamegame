# Vila dos Agentes: conexões e robôs auto-spawn

## Problem Statement

Hoje o dono cria um robô antes de conectar o Codex ou Claude, e o servidor fixa a conexão à primeira sessão que envia um evento. Isso não representa o conceito do jogo: uma conexão deve observar um harness e cada chat ou agent filho deve aparecer como um robô próprio. A feature separa a conexão criada pelo usuário das instâncias de sessão criadas pelo servidor.

## Goals

- [ ] Criar somente conexões de harness no onboarding e gerar robôs automaticamente quando sessões emitirem sinais.
- [ ] Representar chats e agents filhos simultâneos como robôs distintos, com relação pai-filho quando o harness informar essa relação.
- [ ] Preservar privacidade, ordenação, revogação e compatibilidade dos robôs já persistidos.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Iniciar processos reais do Codex, Claude ou Cursor | A Vila observa eventos; o harness continua responsável por criar agents. |
| Recuperar transcript, resposta ou prompt completo | O coletor envia apenas o resumo sanitizado já definido em BUBBLE. |
| Escala horizontal, PostgreSQL ou múltiplas réplicas | O app continua no modelo JSON, uma réplica e volume HML dedicado. |
| Histórico analítico ou replay de sessões encerradas | O MVP mostra o estado atual e o último estado conhecido. |
| Login compartilhado entre providers ou jogos | Conexões continuam isoladas por conta e aplicação. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Unidade visual | Um robô representa um `sessionId`; um agent filho com outro ID vira outro robô | Corresponde ao conceito de N chats/agents na vila | yes |
| Unidade criada no onboarding | O usuário cria uma conexão por harness/provider; nenhum robô é criado manualmente | Um token pode transportar várias sessões do mesmo harness | yes |
| Primeiro evento sem SessionStart | Qualquer evento autenticado com novo `sessionId` cria a instância | Evita perder agents quando um hook de início não for emitido | agent discretion |
| Relação pai-filho | `parentSessionId` é opcional e fica vazio quando o harness não informar | Codex/Claude podem variar no suporte a spawn | agent discretion |
| Robô encerrado | `SessionEnd` marca o robô como completed/offline e mantém o último resumo até o dono remover a conexão | Evita apagar contexto inesperadamente; limpeza automática fica para outra feature | agent discretion |
| Privacidade de novos robôs | Cada instância nasce com o default da conexão, inicialmente `none`; o dono pode alterar por robô | Mantém compartilhamento mínimo e permite exceções | agent discretion |
| Ordenação | O collector mantém uma sequência por conexão; o servidor deduplica por sequência e sessão | Uma instalação pode intercalar eventos de vários agents | agent discretion |
| Harness sem evento de spawn | A sessão ainda é criada no primeiro evento que contenha ID; relação pai fica desconhecida | Permite MVP sem exigir uma API específica de cada provider | agent discretion |
| Limite de sessões | Os limites atuais de corpo, IDs e texto permanecem; não haverá limite artificial de robôs no MVP | O objetivo é remover o teto de 12 robôs, sem inventar um novo teto de produto | agent discretion |

**Open questions:** none; defaults acima fecham as decisões necessárias para o MVP.

## User Stories

### P1: Conectar um harness e gerar sessões ⭐ MVP

**User Story**: Como morador, quero conectar meu Codex, Claude ou Cursor uma vez e ver cada sessão de trabalho nascer como um robô, para que a vila represente o trabalho real sem cadastro manual.

**Acceptance Criteria**:

1. **CONN-01**: WHEN o dono trocar um código de pareamento válido THEN o sistema SHALL criar uma conexão autenticada com provider, token revogável e default de privacidade `none`, sem criar um robô até receber um evento de sessão.
2. **SPAWN-01**: WHEN uma conexão receber o primeiro evento autenticado com `sessionId` novo THEN o sistema SHALL criar e persistir exatamente um robô para aquele `connectionId` + `sessionId` antes de aplicar o evento.
3. **SPAWN-02**: WHEN a mesma conexão receber outro evento da mesma sessão THEN o sistema SHALL atualizar o robô existente e SHALL NOT criar uma segunda instância.
4. **SPAWN-03**: WHEN um evento trouxer `parentSessionId` válido THEN o robô SHALL preservar essa relação na visão do dono e SHALL omitir IDs internos da projeção pública.
5. **LIFE-01**: WHEN uma sessão receber `SessionEnd`, stop ou terminal equivalente THEN o robô SHALL ficar `completed` ou `offline`, manter o último resumo e aceitar nenhum evento de outra sessão.
6. **CONN-02**: WHEN a conexão receber eventos intercalados de N sessões válidas THEN o sistema SHALL processar cada sessão independentemente, sem rejeitar uma apenas porque outra foi vista primeiro.
7. **CONN-03**: IF uma conexão revogada, token inválido, provider incompatível, sessionId inválido ou sequência repetida enviar evento THEN o sistema SHALL responder 401/400 ou `accepted=false` conforme o contrato atual e SHALL NOT criar nem alterar robôs.

**Independent Test**: Parear uma conexão, enviar eventos autenticados para três sessionIds e conferir três robôs distintos, atualização independente, repetição idempotente e encerramento de uma sessão sem afetar as outras.

### P1: Privacidade e leitura da vila

**User Story**: Como dono, quero que os robôs auto-gerados usem minha política de compartilhamento e apareçam agrupados por conexão e relação de spawn, para controlar o que os amigos veem.

**Acceptance Criteria**:

1. **PRIV-01**: WHEN o dono alterar o default da conexão THEN novos robôs SHALL nascer com esse default e robôs existentes SHALL manter sua própria privacidade até serem alterados explicitamente.
2. **PRIV-02**: WHEN a vila projetar um robô para outro morador THEN a projeção SHALL aplicar `none`, `title` ou `description` antes de sair do servidor e SHALL omitir token, sessionId, parentSessionId, connectionId, prompts brutos e eventos.
3. **UI-01**: WHEN o dono abrir o escritório THEN a interface SHALL oferecer criação/rotação/revogação de conexões e SHALL mostrar robôs descobertos por sessão sem formulário manual de robô, título ou descrição.
4. **UI-02**: WHEN um robô filho existir THEN a interface SHALL indicar a conexão/provider e sua relação pai quando houver, mantendo seleção e balão compatíveis com BUBBLE-03.

**Independent Test**: Criar uma conexão, trocar o default de privacidade, gerar duas sessões e um filho, consultar como dono e como outro morador e conferir agrupamento e allowlist.

### P2: Compatibilidade e migração

**User Story**: Como operador, quero atualizar o serviço sem quebrar os robôs já pareados, para fazer a transição sem perder a vila existente.

**Acceptance Criteria**:

1. **MIG-01**: WHEN o serviço reabrir um arquivo com robôs do modelo anterior THEN o sistema SHALL continuar projetando, editando privacidade e recebendo eventos desses robôs como conexões legadas.
2. **MIG-02**: WHEN um coletor antigo enviar o payload aceito antes desta feature THEN o sistema SHALL manter o status, resumo, sequência e erros do contrato anterior sem criar duplicatas.
3. **OPS-01**: WHEN o build, typecheck, testes e `/healthz` forem executados THEN os gates atuais SHALL continuar verdes e a documentação SHALL explicar conexão, auto-spawn, revogação e limites de observação.

**Independent Test**: Reabrir fixture antiga, enviar evento com o payload anterior, executar a suíte completa e verificar o fluxo de conexão nova no HML.

## Edge Cases

- **EDGE-01**: IF dois eventos simultâneos forem os primeiros sinais da mesma sessão THEN somente um robô SHALL ser persistido e ambos SHALL aplicar-se em ordem válida.
- **EDGE-02**: IF dois sessionIds diferentes compartilharem o mesmo parentSessionId THEN ambos SHALL aparecer como filhos distintos; um child sem parent SHALL continuar válido.
- **EDGE-03**: IF um agent não emitir `SessionStart` ou `parentSessionId` THEN o primeiro evento com sessionId SHALL gerar um robô sem relação pai.
- **EDGE-04**: IF um evento de sessão encerrada chegar depois de outra sessão da mesma conexão THEN somente o robô correspondente SHALL mudar de estado.
- **EDGE-05**: IF a persistência falhar durante auto-spawn THEN o sistema SHALL preservar o estado anterior e não responder sucesso parcial.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CONN-01 | P1 Conexão | Foundation | Pending |
| SPAWN-01 | P1 Conexão | Core | Pending |
| SPAWN-02 | P1 Conexão | Core | Pending |
| SPAWN-03 | P1 Conexão | Core | Pending |
| LIFE-01 | P1 Conexão | Core | Pending |
| CONN-02 | P1 Conexão | Core | Pending |
| CONN-03 | P1 Conexão | Core | Pending |
| PRIV-01 | P1 Privacidade | Integration | Pending |
| PRIV-02 | P1 Privacidade | Integration | Pending |
| UI-01 | P1 Privacidade | Integration | Pending |
| UI-02 | P1 Privacidade | Integration | Pending |
| MIG-01 | P2 Compatibilidade | Compatibility | Pending |
| MIG-02 | P2 Compatibilidade | Compatibility | Pending |
| OPS-01 | P2 Compatibilidade | Compatibility | Pending |

**Coverage:** 14 total, 0 mapped to tasks, 14 unmapped ⚠️

## Success Criteria

- [ ] Uma instalação de Codex ou Claude gera N robôs distintos para N sessionIds sem criação manual.
- [ ] Dois agents simultâneos preservam estado, título, descrição, privacidade e encerramento de forma independente.
- [ ] Nenhum segredo, prompt bruto ou ID interno aparece na projeção pública.
- [ ] Robôs legados continuam funcionando e todos os gates do workspace passam.
