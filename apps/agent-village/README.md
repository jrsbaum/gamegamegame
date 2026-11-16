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

## Coletor

O cadastro de um robô devolve um token uma única vez. O coletor envia somente eventos normalizados do provedor para `POST /api/events` com `Authorization: Bearer <token>` e um `sequence` crescente. O token não pode criar contas, alterar privacidade ou acessar outro robô. O servidor descarta prompts, argumentos, respostas, nomes de arquivos e credenciais antes de atualizar o estado.

O público recebe uma projeção allowlist. `none` (padrão) mostra só estado; `title` acrescenta o título autorizado; `description` acrescenta título e descrição autorizados. `lastSignalAt` é apenas o horário do último sinal aceito. Sem coletor ativo, o app não promete atividade ao vivo.

## Persistência e limites

O arquivo JSON é gravado com transação serial, arquivo temporário, `fsync` e rename. Uma réplica é obrigatória: duas réplicas podem sobrescrever o arquivo. Após reinício, robôs que estavam trabalhando voltam como offline até receberem um novo evento. O volume deve ter backup próprio e nunca pode ser compartilhado com outro jogo.

## Deploy

Os Compose versionados estão em `infra/dokploy/agent-village`. Produção usa `main` e `agents.gamegamegame.site`; HML usa `staging` e `hml-agents.gamegamegame.site`. Cada ambiente exige invite code, volume e router próprios, a rede externa `dokploy-network`, TLS e uma réplica. O serviço aceita `TRUST_PROXY=true` somente atrás do proxy Traefik; acesso direto à porta não deve ser publicado.

Consulte [`infra/dokploy/agent-village/README.md`](../../infra/dokploy/agent-village/README.md) para criar o serviço, validar o Compose, fazer backup e promover HML para produção.
