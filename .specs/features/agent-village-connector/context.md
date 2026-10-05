# Vila dos Agentes Connector Onboarding Context

**Gathered:** 2026-10-05
**Spec:** `.specs/features/agent-village-connector/spec.md`
**Status:** Ready for design

## Feature Boundary

Adicionar onboarding guiado para Codex e Claude Code: o dono escolhe provedor, shell e nome; recebe um código temporário e comando copiável; o instalador troca o código por token e mescla hooks locais; o primeiro evento vincula a sessão automaticamente. O login nativo do provedor, a coleta de conteúdo e o Cursor manual continuam fora deste recorte.

## Implementation Decisions

### Pareamento

- O código aparece uma vez na tela e expira em 10 minutos.
- O servidor persiste somente o hash do código e remove pareamentos expirados.
- O robô pendente já aparece na mesa com estado `pending`, mas não aceita eventos até a troca do código.
- O token permanente é criado no momento da troca e só é devolvido ao instalador.

### Shell e comandos

- PowerShell é o padrão no Windows; Git Bash e zsh usam o mesmo instalador Node através de wrappers POSIX.
- O comando contém apenas o código temporário e a origem HTTPS.
- O instalador Node usa `fetch`, grava o coletor em diretório próprio e faz merge JSON atômico.

### Hooks

- Codex: `~/.codex/hooks.json`, eventos de sessão, prompt, ferramenta, parada e encerramento.
- Claude: `~/.claude/settings.json`, eventos de prompt, ferramenta, permissão, parada e sessão.
- Configuração existente é preservada; um hook duplicado do mesmo robô não é adicionado novamente.
- O coletor retorna sem saída e falha sem bloquear o agente quando a rede está indisponível.

### Sessão e privacidade

- O primeiro evento válido do provedor vincula o `sessionId` ao robô pendente.
- O coletor faz allowlist antes do POST; o servidor mantém a segunda validação.
- Sequência é protegida por lock de arquivo local e escrita atômica.
- O comando de desinstalação remove somente o bloco identificado pelo `robotId`.

## Deferred Ideas

- OAuth para entrar na Vila.
- Instalador gráfico assinado.
- Wizard equivalente para Cursor.
- Buffer persistente de eventos offline.
