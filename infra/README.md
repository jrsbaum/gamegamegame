# GameGameGame: infraestrutura Dokploy

Esta pasta contém a topologia versionada para cinco aplicações independentes,
todas apontando para o repositório `gamegamegame` e a branch `main` no Dokploy:

- `dokploy/lobby`: `gamegamegame.site`;
- `dokploy/whoami`: `whoami.gamegamegame.site`;
- `dokploy/impostor`: `impostor.gamegamegame.site`;
- `dokploy/caracol`: `caracol.gamegamegame.site` e PostgreSQL próprio;
- `dokploy/lafarmer`: web, servidor e PostgreSQL próprio.

## Variáveis

Copie `dokploy/.env.example` apenas para uso local de validação. No Dokploy,
cadastre os valores no ambiente da aplicação. Os nomes de volume
`CARACOL_POSTGRES_VOLUME` deve ser o nome já existente no ambiente de
produção. O LaFarmer mantém compatibilidade com o ambiente legado do Dokploy:
usa `WEB_DOMAIN`, `POSTGRES_*`, `DATABASE_URL` e `SESSION_SECRET`, além de
preservar o volume externo `lafarmer-lafarmer-vyw0ox_lafarmer-postgres`.
Nenhum compose cria volumes de produção automaticamente.

Além das variáveis de domínio e banco, Caracol precisa das chaves VAPID.
Segredos não devem ser versionados.

## Rede e WebSocket

Cada aplicação usa uma rede privada própria quando precisa de PostgreSQL e a
rede externa `dokploy-network` apenas para o Traefik. Os jogos do monorepo
servem frontend, HTTP e Socket.IO no mesmo processo e domínio; por isso
`VITE_SERVER_URL` fica vazio. LaFarmer usa o mesmo domínio para `/api`, `/ws`,
`/healthz` e as rotas web, com o router da API tendo prioridade maior.

## Validação local

A partir da raiz do repositório, com Docker instalado:

```powershell
$env:CARACOL_POSTGRES_VOLUME='nome-real-do-volume-caracol'
$env:LAFARMER_POSTGRES_VOLUME='nome-real-do-volume-lafarmer'
docker compose --env-file infra/dokploy/.env.example -f infra/dokploy/lobby/docker-compose.yml config --quiet
docker compose --env-file infra/dokploy/.env.example -f infra/dokploy/whoami/docker-compose.yml config --quiet
docker compose --env-file infra/dokploy/.env.example -f infra/dokploy/impostor/docker-compose.yml config --quiet
docker compose --env-file infra/dokploy/.env.example -f infra/dokploy/caracol/docker-compose.yml config --quiet
docker compose --env-file infra/dokploy/.env.example -f infra/dokploy/lafarmer/docker-compose.yml config --quiet
```

Os Compose não publicam portas no host e não acessam o Dokploy real. Antes de
qualquer deploy, confirme no Dokploy que cada aplicação usa `main`, os nomes
de volume correspondem ao backup/estado existente e a rede
`dokploy-network` já existe.
