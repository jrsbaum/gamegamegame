# Vila dos Agentes

MVP independente da GameGameGame: uma vila 3D compartilhada em que cada morador tem uma mesa e cada robô representa uma sessão de Codex, Cursor ou Claude Code.

## Desenvolvimento

Use Node 22 na pasta do app:

```powershell
npm install
npm run dev:server   # API em http://127.0.0.1:3340
npm run dev          # Vite em http://127.0.0.1:5176
```

`npm test`, `npm run typecheck` e `npm run build` são os gates locais. O servidor usa `DATA_FILE` para o arquivo persistido; a demonstração exibida no navegador é fictícia e não observa nenhuma conta automaticamente.

## Conectar Codex ou Claude Code

Depois de entrar na vila, abra **Minha mesa e conexões → Conectar um harness**. Escolha Codex ou Claude Code, dê um nome para a instalação, selecione a privacidade padrão e escolha o terminal (PowerShell, Git Bash ou zsh). A vila cria um código temporário de dez minutos e mostra um comando copiável. O comando baixa um instalador Node pelo mesmo domínio, troca o código uma única vez por um token da conexão e mescla os hooks em `~/.codex/hooks.json` ou `~/.claude/settings.json`, preservando os blocos existentes.

O login do Codex ou Claude continua no aplicativo do provedor. A vila não pede senha, API key ou transcript. O primeiro evento recebido cria automaticamente um robô para aquela sessão; chats e agents filhos criam outros robôs sob a mesma conexão, sem cadastro manual de título ou descrição. O `parentSessionId`, quando o harness envia esse dado, organiza a árvore só na visão do dono. Girar o token revoga o anterior; revogar a conexão impede novos sinais.

O pareamento usa `POST /api/pairings` (cookie da conta) e `POST /api/pairings/exchange` (código de uso único). O coletor local deriva da tarefa atual um título da primeira linha e uma descrição curta, ambos limitados, e envia somente esse resumo junto do provedor, sessão, ação de ciclo de vida, IDs de ferramenta/turno permitidos e sequência para `POST /api/events`. O prompt completo, argumentos, respostas, caminhos, tokens e credenciais são filtrados antes do envio e novamente no servidor; blocos de código e linhas identificadas como resposta também ficam fora do resumo.

## Coletor

O cadastro de uma conexão devolve um token uma única vez. O coletor envia somente eventos normalizados do provedor para `POST /api/events` com `Authorization: Bearer <token>` e um `sequence` crescente por conexão. O token não pode criar contas, alterar privacidade ou acessar outra conexão. O servidor resolve cada evento pela chave composta conexão + sessão, descarta prompts, argumentos, respostas, nomes de arquivos e credenciais antes de atualizar o estado e aceita sessões intercaladas.

O público recebe uma projeção allowlist. `none` (padrão) mostra só estado no balão do robô; `title` mostra somente o título atual no balão; `description` mostra estado e título abreviado no balão e deixa a descrição atual no caderninho. O título e a descrição nunca são digitados manualmente no navegador. `lastSignalAt` é apenas o horário do último sinal aceito. Sem coletor ativo, o app não promete atividade ao vivo.

## Tempo real

A interface abre `wss://<domínio>/ws` na mesma origem depois do login. O cookie de sessão HttpOnly autentica o handshake; nenhum token do coletor vai para a URL do WebSocket. O servidor envia um `hello` com o snapshot inicial, aceita `snapshot.get` e transmite `snapshot` quando um coletor altera a vila. O navegador reconecta com atraso progressivo e mantém o polling HTTP somente como fallback quando o socket está indisponível. A projeção enviada pelo socket usa a mesma allowlist pública da API e não contém sessão, parent, conexão ou segredo.

## Persistência e limites

O arquivo JSON é gravado com transação serial, arquivo temporário, `fsync` e rename. Uma réplica é obrigatória: duas réplicas podem sobrescrever o arquivo. Após reinício, robôs que estavam trabalhando voltam como offline até receberem um novo evento. O volume deve ter backup próprio e nunca pode ser compartilhado com outro jogo.

## Deploy

Os Compose versionados estão em `infra/dokploy/agent-village`. Produção usa `main` e `agents.gamegamegame.site`; HML usa `staging` e `hml-agents.gamegamegame.site`. Cada ambiente exige invite code, volume e router próprios, a rede externa `dokploy-network`, TLS e uma réplica. O serviço aceita `TRUST_PROXY=true` somente atrás do proxy Traefik; acesso direto à porta não deve ser publicado.

Consulte [`infra/dokploy/agent-village/README.md`](../../infra/dokploy/agent-village/README.md) para criar o serviço, validar o Compose, fazer backup e promover HML para produção.
