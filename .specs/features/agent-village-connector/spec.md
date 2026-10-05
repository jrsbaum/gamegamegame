# Vila dos Agentes Connector Onboarding Specification

## Problem Statement

O MVP atual exige que o morador descubra o `sessionId`, crie um robô manualmente e guarde um token. Isso torna a integração real difícil de iniciar e mantém a maior parte das visitas na demonstração. Esta feature transforma o cadastro em um pareamento guiado para Codex e Claude Code, com comandos adequados ao terminal escolhido e sem pedir credenciais do provedor.

## Goals

- [ ] Permitir que um morador crie um robô sem conhecer o ID privado da sessão.
- [ ] Entregar um código temporário de pareamento e um comando copiável para PowerShell, Git Bash ou zsh.
- [ ] Instalar o coletor local, preservar hooks existentes e confirmar o primeiro sinal na vila.
- [ ] Manter token, prompts, argumentos, respostas, caminhos e credenciais fora da projeção e dos logs.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Login OAuth com OpenAI ou Anthropic | A autenticação nativa continua no Codex/Claude; a vila usa conta própria e token do robô. |
| Captura de conversas ou transcripts | O produto só precisa de estado e ciclo de vida. |
| Instalação automática em todas as máquinas de uma equipe | O usuário instala conscientemente no computador escolhido. |
| Migração do cadastro manual de Cursor | Cursor permanece compatível com o endpoint existente; o wizard P1 cobre Codex e Claude. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Código de pareamento | Código aleatório de uso único, válido por 10 minutos | Evita colocar o token permanente na linha de comando e permite retry consciente. | yes |
| Robô durante pareamento | Robô pendente aparece na mesa com estado “Aguardando instalação” | O usuário vê progresso enquanto o instalador troca o código pelo token. | agent discretion |
| Sessão | O primeiro evento válido vincula automaticamente o `sessionId`; depois o vínculo é imutável | O usuário não precisa copiar IDs e o token continua limitado a um robô. | agent discretion |
| Shell | PowerShell, Git Bash e zsh, com PowerShell selecionado por padrão no Windows | Cobre os terminais citados sem esconder o comando gerado. | yes |
| Hooks | Codex usa `~/.codex/hooks.json`; Claude usa `~/.claude/settings.json`; arquivos existentes são mesclados | Preserva configurações pessoais e torna a instalação reversível. | agent discretion |
| Expiração | Pareamento expirado remove o robô ainda não provisionado | Evita lixo persistido e códigos reutilizáveis. | agent discretion |

**Open questions:** none; all decisions are resolved or recorded above.

## User Stories

### P1: Parear um agente sem conhecimento técnico de IDs ⭐ MVP

**User Story**: Como morador, quero escolher Codex ou Claude, dar um nome ao agente e receber instruções específicas para meu terminal, para conectar sem descobrir IDs internos.

**Acceptance Criteria**:

1. WHEN o morador autenticado abrir “Adicionar agente” THEN o cliente SHALL oferecer Codex e Claude Code, nome do agente e PowerShell, Git Bash ou zsh.
2. WHEN o morador enviar provedor e nome válidos THEN o servidor SHALL criar um pareamento com código único, hash persistido, validade de 10 minutos e robô pendente sem `sessionId` exposto a terceiros.
3. WHEN o cliente receber o pareamento THEN SHALL exibir um comando específico do shell escolhido, botão de copiar e validade restante, sem exibir o token permanente.
4. IF provedor, nome, shell ou conta forem inválidos THEN o sistema SHALL responder com erro sem criar robô, token ou pareamento utilizável.

**Independent Test**: Entrar, abrir o wizard, escolher cada provedor e shell, criar o pareamento e comparar o comando exibido.

### P1: Instalação do coletor e primeiro sinal ⭐ MVP

**User Story**: Como morador, quero executar o comando exibido para instalar o hook e ver a vila confirmar a conexão.

**Acceptance Criteria**:

1. WHEN o comando de instalação receber um código válido THEN o instalador SHALL trocar o código uma única vez por um token de robô, gravar configuração local e mesclar somente os hooks necessários.
2. WHEN o instalador for executado novamente com o mesmo código THEN o servidor SHALL responder 410 sem emitir outro token ou alterar o robô.
3. WHEN o coletor enviar o primeiro evento válido THEN o servidor SHALL vincular o `sessionId` ao robô pendente e aceitar o evento.
4. IF um evento posterior usar provedor ou `sessionId` incompatível THEN o servidor SHALL rejeitar a entrada sem alterar o estado.
5. WHEN o cliente consultar a vila após a instalação THEN SHALL mostrar “Aguardando primeiro sinal”, “Conectado” ou erro acionável conforme o estado recebido.

**Independent Test**: Trocar um código em ambiente temporário, enviar um evento Codex/Claude sanitizado e confirmar a transição pendente → conectado.

### P1: Privacidade e reversibilidade

**User Story**: Como morador, quero entender o que é enviado e remover a conexão sem afetar meu login no provedor.

**Acceptance Criteria**:

1. The collector SHALL send only provider, session identifier, lifecycle action, tool identifier when needed, run identifier when needed and sequence.
2. The system SHALL never include the robot token, prompt, arguments, tool output, response, filename or credential in a public snapshot, error response or persisted event.
3. WHEN o morador remover ou girar o token THEN o token anterior SHALL responder 401 e o hook local SHALL have a documented uninstall path.

**Independent Test**: Inspecionar payload sanitizado, snapshot de outro morador, arquivo persistido e revogação do token.

## Edge Cases

- IF o código estiver expirado, usado ou malformado THEN o servidor SHALL responder 410 ou 400 sem revelar se outro código existe.
- IF o arquivo de configuração do hook contiver JSON inválido THEN o instalador SHALL parar antes de sobrescrever e instruir backup/restauração.
- IF a rede estiver indisponível THEN o coletor SHALL falhar silenciosamente para não bloquear o agente e registrar somente erro local não sensível.
- IF dois hooks enviarem eventos ao mesmo tempo THEN as sequências SHALL permanecer estritamente crescentes por robô.
- IF o processo reiniciar durante o pareamento THEN o estado persistido SHALL manter somente pareamentos ainda dentro do prazo.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CONN-01 | Parear | Design | Pending |
| CONN-02 | Parear | T1 | Implementing |
| CONN-03 | Parear | T3 | Pending |
| CONN-04 | Parear | T1 | Implementing |
| CONN-05 | Instalação | T2 | Pending |
| CONN-06 | Instalação | T1 | Implementing |
| CONN-07 | Instalação | T1 | Implementing |
| CONN-08 | Instalação | T1 | Implementing |
| CONN-09 | Instalação | Design | Pending |
| CONN-10 | Privacidade | Design | Pending |
| CONN-11 | Privacidade | Design | Pending |
| CONN-12 | Privacidade | Design | Pending |

**Coverage:** 12 total, 0 mapped to tasks, 12 unmapped.

## Success Criteria

- [ ] Um usuário completa o pareamento sem digitar `sessionId`.
- [ ] Cada shell mostra um comando copiável e a instalação não sobrescreve hooks existentes.
- [ ] Um primeiro evento real muda o robô pendente para estado ativo sem vazar conteúdo privado.
