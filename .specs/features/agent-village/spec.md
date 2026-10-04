# Vila dos Agentes Specification

## Problem Statement

O ensaio local mostra amigos e robôs trabalhando num escritório 3D, mas não tem servidor, contas nem deploy próprio. Esta feature entrega um MVP executável na GameGameGame com a mesma atmosfera e uma fronteira real de privacidade.

## Goals

- [ ] Entrar numa vila 3D compartilhada e inspecionar moradores, mesas e robôs.
- [ ] Receber eventos autenticados por sessão sem transmitir conteúdo privado aos amigos.
- [ ] Reiniciar o serviço preservando contas, mesas, robôs e credenciais revogáveis.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Monitorar automaticamente contas Codex/ChatGPT/Cursor/Claude | O serviço só recebe eventos enviados por um coletor autorizado. |
| Instalar hooks ou OAuth nos computadores dos amigos | Integração local precisa de configuração consciente por cada dono. |
| Chat, economia, agricultura jogável e múltiplas vilas | O MVP é presença e acompanhamento de trabalho numa vila acolhedora. |
| Escala horizontal, PostgreSQL e recuperação de senha | Persistência local com uma réplica atende ao grupo inicial; não compartilha dados com outros jogos. |
| Operar serviços remotos ou promover main | A implementação prepara artefatos locais; a etapa de Dokploy é separada. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Nome e destinos | Vila dos Agentes; apps/agent-village; agents.gamegamegame.site; hml-agents.gamegamegame.site | Confirmados pelo usuário em 2026-10-04 | yes |
| Entrada dos amigos | Uma vila por serviço; cadastro exige código de convite do ambiente | Limita entrada e permite MVP sem convites por e-mail | agent discretion |
| Persistência | JSON com rename atômico, fila serial de transações e uma réplica | Evita banco compartilhado e preserva o estado no volume dedicado | agent discretion |
| Autenticação | Senha scrypt, cookie HttpOnly com expiração de 30 dias; token distinto por robô | Browser e coletor têm escopos distintos | agent discretion |
| Sincronização | Consulta autenticada a cada 3 segundos; presença expira após 20 segundos | Simplicidade operacional e dono pode offline com robô ativo | agent discretion |
| Eventos atrasados | sequence crescente por robô; eventos repetidos/atrasados não mudam estado | Ordem explícita funciona em todos os provedores | agent discretion |
| Sessões de trabalho após restart | Estados ativos viram offline; histórico de configuração continua | Não alegar atividade ao vivo sem coletor reenviando eventos | agent discretion |

**Open questions:** none; decisões rotineiras autorizadas pela instrução de implementar.

## User Stories

### P1: Vila e escritório

**User Story**: Como amigo, quero visitar o jardim e o escritório e identificar as mesas e chats da turma.

**Acceptance Criteria**:

1. **WORLD-01**: WHEN o visitante abrir a demonstração THEN o cliente SHALL exibir jardim e escritório em Three.js, três moradores fictícios e cinco robôs identificados como simulação.
2. **WORLD-02**: WHEN o usuário selecionar uma mesa ou robô no cenário ou na lista acessível THEN o cliente SHALL exibir o dono, provedor e estado recebidos, e apenas título/descrição presentes na projeção autorizada.
3. **WORLD-03**: WHEN o dono salvar o tamanho da mesa THEN o servidor SHALL aceitar somente small, medium ou large e persistir a escolha.
4. **WORLD-04**: WHILE WebGL estiver indisponível o cliente SHALL manter lista, seleção, login e controles utilizáveis com mensagem de fallback.
5. **WORLD-05**: WHILE reduced-motion estiver ativo o cliente SHALL desativar animação contínua dos robôs.

**Independent Test**: Abrir demo, entrar no escritório, selecionar Renatin/Cursor e Julin/Claude, comparar projeção e navegar por teclado.

### P1: Contas e fronteiras

**User Story**: Como morador, quero configurar meus próprios robôs sem dar acesso à minha conta ou aos dados privados.

**Acceptance Criteria**:

1. **AUTH-01**: WHEN o cadastro receber convite correto, username de 3..24 caracteres [a-z0-9_-], nome de 1..32 e senha de 10..128 caracteres THEN o servidor SHALL criar conta isolada, mesa medium e cookie HttpOnly com SameSite=Strict e prazo de 30 dias.
2. **AUTH-02**: IF convite/senha forem inválidos ou credencial faltar THEN o servidor SHALL responder 403/401 respectivamente sem transmitir estado da vila.
3. **AUTH-03**: WHEN login correto ocorrer THEN o servidor SHALL autenticar somente a conta deste serviço; WHEN logout ocorrer THEN o servidor SHALL revogar a sessão correspondente.
4. **AUTH-04**: IF uma conta tentar editar mesa, metadados, privacidade, excluir ou girar token de robô de outra conta THEN o servidor SHALL responder 404 sem alterar o recurso.
5. **AUTH-05**: IF escrita browser tiver Origin diferente do PUBLIC_ORIGIN configurado THEN o servidor SHALL responder 403; IF exceder 20 tentativas de autenticação por IP em 10 minutos THEN o servidor SHALL responder 429.

**Independent Test**: Criar duas contas com cookie separado; tentar mutações cruzadas e confirmar que sessão expirada/revogada não acessa a vila.

### P1: Sessões, eventos e compartilhamento

**User Story**: Como morador, quero que vários chats trabalhem ao mesmo tempo e compartilhem só o que eu escolhi.

**Acceptance Criteria**:

1. **ROBOT-01**: WHEN o dono registrar provedor codex, cursor ou claude, sessionId de 1..128, label de 1..32 e metadados limitados THEN o servidor SHALL criar um robô com privacidade none, estado idle e token retornado uma única vez; uma sessão duplicada do mesmo dono/provedor SHALL responder 409; o limite SHALL ser 12 robôs por conta.
2. **ROBOT-02**: WHEN um coletor enviar evento com token válido do robô e sessionId/provedor compatíveis THEN o servidor SHALL atualizar somente aquele robô; IF usar cookie browser, token revogado ou outra sessão THEN o servidor SHALL responder 401/400 sem alteração.
3. **ROBOT-03**: WHEN sequence de um evento for menor ou igual à última sequência THEN o servidor SHALL responder accepted=false sem alterar estado; WHEN ferramentas concorrentes terminarem THEN o robô SHALL continuar tool até a última terminar e working depois, concluindo somente no fim de turno.
4. **ROBOT-04**: WHEN o servidor projetar um robô para outro morador THEN o servidor SHALL transmitir uma allowlist de id, ownerId, label, provider, status e simulated; none SHALL omitir title e description; title SHALL incluir apenas title; description SHALL incluir ambos; sessionId, tools, runId, eventos brutos e tokens SHALL sempre ser omitidos.
5. **ROBOT-05**: WHEN o dono alterar privacidade THEN a próxima resposta da vila SHALL refletir exatamente none/title/description; IF valor for inválido THEN o servidor SHALL responder 400.
6. **ROBOT-06**: WHILE o dono estiver offline o robô SHALL continuar recebendo eventos autenticados; presença do dono SHALL ficar offline após 20 segundos sem consulta autenticada.
7. **ROBOT-07**: WHEN o token for girado ou o robô excluído THEN o token anterior SHALL responder 401; o token atual SHALL controlar somente eventos daquele robô.
8. **ROBOT-08**: WHEN um evento de leitura, ferramenta, espera, conclusão, interrupção ou falha for aceito THEN o robô SHALL projetar reading, tool, waiting, completed, interrupted ou error respectivamente.

**Independent Test**: Enviar eventos de duas sessões Codex da mesma conta e ferramentas concorrentes; consultar como outro dono em cada nível de privacidade.

### P1: Persistência e distribuição

**User Story**: Como operador, quero instalar o jogo no Dokploy e homologar sem tocar nos dados dos outros jogos.

**Acceptance Criteria**:

1. **OPS-01**: WHEN a transação concluir THEN o store SHALL gravar contas, hashes, sessões, mesas e robôs em arquivo dedicado antes de responder; IF a gravação falhar THEN o store SHALL preservar o estado anterior; WHEN reabrir o arquivo THEN configuração e credenciais SHALL continuar válidas e robôs ativos SHALL ficar offline.
2. **OPS-02**: WHEN GET /healthz ocorrer THEN o servidor SHALL responder 200 com ok=true e service=agent-village; WHEN build de produção for servido THEN / SHALL entregar o cliente e /api SHALL usar a mesma origem.
3. **OPS-03**: The deploy SHALL usar Node 22, uma réplica, volume externo próprio, dokploy-network, TLS e nomes de routers exclusivos por ambiente; HML SHALL usar staging, hml-agents.gamegamegame.site e volume/secrets separados de produção.
4. **OPS-04**: WHEN o lobby listar jogos THEN o catálogo SHALL conter Vila dos Agentes com destino https://agents.gamegamegame.site/ e a versão HML SHALL apontar https://hml-agents.gamegamegame.site/.
5. **OPS-05**: The documentação SHALL explicar dev, teste, build, protocolo do coletor, limites de observação automática, backup do arquivo/volume e promoção staging → main sem outros trabalhos locais.

**Independent Test**: Reiniciar store temporário; construir cliente e Compose; conferir links do lobby e documentação.

## Edge Cases

- **EDGE-01**: IF corpo HTTP exceder 32 KiB ou JSON for inválido THEN o servidor SHALL responder 413 ou 400 sem refletir corpo/segredos.
- **EDGE-02**: IF título exceder 120, descrição 280, ID 128, texto tiver controles ou campo desconhecido for enviado numa mutação THEN o servidor SHALL responder 400.
- **EDGE-03**: IF um evento de turno anterior tiver runId incompatível THEN o reducer SHALL ignorá-lo; IF um evento não for reconhecido THEN o servidor SHALL responder 400.
- **EDGE-04**: IF houver mais de 100 contas ou 12 robôs numa conta THEN o serviço SHALL responder 409 sem criar recursos extras.
- **EDGE-05**: IF arquivo persistido estiver corrompido THEN o servidor SHALL falhar o startup sem substituir o arquivo.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| WORLD-01 | Vila | T5 | Pending |
| WORLD-02 | Vila | T5 | Pending |
| WORLD-03 | Vila | T3 | Pending |
| WORLD-04 | Vila | T5 | Pending |
| WORLD-05 | Vila | T5 | Pending |
| AUTH-01 | Contas | T3/T4 | Pending |
| AUTH-02 | Contas | T3/T4 | Pending |
| AUTH-03 | Contas | T3/T4 | Pending |
| AUTH-04 | Contas | T3/T4 | Pending |
| AUTH-05 | Contas | T4 | Pending |
| ROBOT-01 | Sessões | T3 | Pending |
| ROBOT-02 | Sessões | T3/T4 | Pending |
| ROBOT-03 | Sessões | T2/T3 | Pending |
| ROBOT-04 | Sessões | T2/T3/T4 | Pending |
| ROBOT-05 | Sessões | T3/T4 | Pending |
| ROBOT-06 | Sessões | T3 | Pending |
| ROBOT-07 | Sessões | T3/T4 | Pending |
| ROBOT-08 | Sessões | T2/T5 | Pending |
| OPS-01 | Operação | T3 | Pending |
| OPS-02 | Operação | T4 | Pending |
| OPS-03 | Operação | T7 | Pending |
| OPS-04 | Operação | T6 | Pending |
| OPS-05 | Operação | T7 | Pending |
| EDGE-01 | Limites | T4 | Pending |
| EDGE-02 | Limites | T3/T4 | Pending |
| EDGE-03 | Limites | T2/T3 | Pending |
| EDGE-04 | Limites | T3 | Pending |
| EDGE-05 | Limites | T3 | Pending |

**Coverage:** 28 total, 28 mapped to tasks, 0 unmapped.

## Success Criteria

- [ ] Testes do novo app, catálogo e lobby passam com Node 22.
- [ ] Build e Compose validam localmente.
- [ ] QA browser cobre demo, cadastro, mesa, robôs e navegação por cenário.
- [ ] Verifier independente registra PASS antes de declarar feature concluída.
