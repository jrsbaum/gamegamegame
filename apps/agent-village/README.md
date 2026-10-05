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

Depois de entrar na vila, abra **Minha mesa e meus robôs → Adicionar Codex ou Claude**. Escolha o provedor, um nome para o agente e o terminal que você usa (PowerShell, Git Bash ou zsh). A vila cria um código temporário de dez minutos e mostra um comando copiável. O comando baixa um instalador Node pelo mesmo domínio, troca o código uma única vez por um token do robô e mescla os hooks em `~/.codex/hooks.json` ou `~/.claude/settings.json`, preservando os blocos existentes.

O login do Codex ou Claude continua no aplicativo do provedor. A vila não pede senha, API key ou transcript. O primeiro evento recebido vincula automaticamente o ID privado da sessão; ele não precisa ser digitado no navegador. Para remover a conexão, use **Remover robô** e retire o bloco identificado pelo comando do agente no arquivo de hooks local. Girar o token revoga o anterior.

O pareamento usa `POST /api/pairings` (cookie da conta) e `POST /api/pairings/exchange` (código de uso único). O coletor local envia apenas provedor, sessão, ação de ciclo de vida, IDs de ferramenta/turno permitidos e sequência para `POST /api/events`. Prompts, argumentos, respostas, caminhos, tokens e credenciais são filtrados antes do envio e novamente no servidor.

## Coletor

O cadastro de um robô devolve um token uma única vez. O coletor envia somente eventos normalizados do provedor para `POST /api/events` com `Authorization: Bearer <token>` e um `sequence` crescente. O token não pode criar contas, alterar privacidade ou acessar outro robô. O servidor descarta prompts, argumentos, respostas, nomes de arquivos e credenciais antes de atualizar o estado.

O público recebe uma projeção allowlist. `none` (padrão) mostra só estado; `title` acrescenta o título autorizado; `description` acrescenta título e descrição autorizados. `lastSignalAt` é apenas o horário do último sinal aceito. Sem coletor ativo, o app não promete atividade ao vivo.

## Persistência e limites

O arquivo JSON é gravado com transação serial, arquivo temporário, `fsync` e rename. Uma réplica é obrigatória: duas réplicas podem sobrescrever o arquivo. Após reinício, robôs que estavam trabalhando voltam como offline até receberem um novo evento. O volume deve ter backup próprio e nunca pode ser compartilhado com outro jogo.

## Deploy

Os Compose versionados estão em `infra/dokploy/agent-village`. Produção usa `main` e `agents.gamegamegame.site`; HML usa `staging` e `hml-agents.gamegamegame.site`. Cada ambiente exige invite code, volume e router próprios, a rede externa `dokploy-network`, TLS e uma réplica. O serviço aceita `TRUST_PROXY=true` somente atrás do proxy Traefik; acesso direto à porta não deve ser publicado.

Consulte [`infra/dokploy/agent-village/README.md`](../../infra/dokploy/agent-village/README.md) para criar o serviço, validar o Compose, fazer backup e promover HML para produção.
