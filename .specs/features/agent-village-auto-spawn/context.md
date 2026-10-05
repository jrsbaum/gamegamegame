# Vila dos Agentes: conexões e robôs auto-spawn

**Gathered:** 2026-10-05  
**Spec:** `.specs/features/agent-village-auto-spawn/spec.md`  
**Status:** Ready for design

## Feature Boundary

O usuário cadastra conexões de harness. O servidor transforma cada sessão/agent observado em uma instância de robô, atualiza seu ciclo de vida e mantém as regras atuais de privacidade e segurança. A Vila não inicia agents nem captura transcripts.

## Implementation Decisions

### Conexão versus robô

- Pairing troca um token de conexão; o pairing não cria uma instância visual.
- Uma conexão pode transportar N sessionIds do mesmo provider.
- Um robô é a projeção visual de uma sessão; a chave lógica é `connectionId + sessionId`.

### Spawn e ciclo de vida

- O primeiro evento autenticado de uma sessão cria o robô, mesmo se não houver `SessionStart`.
- Eventos seguintes atualizam somente a sessão correspondente.
- `parentSessionId` é opcional; quando presente, a UI exibe a árvore sem expor o ID.
- `SessionEnd` deixa o robô encerrado e preserva o último resumo até remoção da conexão.

### Privacidade

- Novos robôs usam o default da conexão, começando em `none`.
- Privacidade individual continua editável pelo dono.
- A projeção pública segue a allowlist e nunca recebe IDs ou payloads brutos.

### Compatibilidade

- Registros antigos continuam sendo tratados como robôs legados vinculados a uma conexão implícita.
- Payloads antigos continuam aceitos quando já faziam parte do contrato.
- O limite antigo de 12 robôs deixa de ser regra de produto para instâncias auto-geradas; limites de entrada permanecem.

## Agent's Discretion

- Nomes visuais gerados (`Codex 1`, `Claude 2`, etc.), desde que estáveis e legíveis.
- Como representar a árvore de parent/child quando o parent não estiver presente na lista atual.
- Se a conexão aparecer como uma seção recolhível ou como um cabeçalho de agrupamento.

## Deferred Ideas

- Histórico/replay de tarefas encerradas.
- Limpeza automática por TTL.
- Eventos nativos de spawn específicos de cada provider.
- Filtros por conexão, provider ou árvore de agents.
