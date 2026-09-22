# GameGameGame

Monorepo oficial da plataforma GameGameGame. Ele reúne o lobby e os quatro
jogos publicados em domínios separados, com deploy independente e estado
isolado por aplicação.

| Aplicação | Domínio | Runtime | Persistência |
| --- | --- | --- | --- |
| Lobby | [gamegamegame.site](https://gamegamegame.site) | React/Vite estático | nenhuma |
| Quem Sou Eu | [whoami.gamegamegame.site](https://whoami.gamegamegame.site) | React/Vite + Express/Socket.IO | própria da aplicação |
| Quem é o Impostor | [impostor.gamegamegame.site](https://impostor.gamegamegame.site) | React/Vite + Express/Socket.IO | própria da aplicação |
| Caracol | [caracol.gamegamegame.site](https://caracol.gamegamegame.site) | React/Vite + Express/Socket.IO | PostgreSQL próprio |
| LaFarmer | [lafarmer.gamegamegame.site](https://lafarmer.gamegamegame.site) | Vite/Phaser + Fastify/WebSocket | PostgreSQL próprio |

Login, salas, sessões e bancos continuam separados. Um jogo não deve ler ou
alterar o estado de outro.

## Estrutura

```text
apps/
  lobby/       lobby estático e catálogo de jogos
  whoami/      Quem Sou Eu
  impostor/    Quem é o Impostor
  caracol/     Caracol + Socket.IO + PostgreSQL
  lafarmer/    workspace interno do LaFarmer
packages/
  game-catalog/       catálogo tipado consumido pelo lobby
  platform-contracts/ contratos compartilhados da plataforma
  shared-ui/          componentes visuais compartilhados
infra/
  docker/             Dockerfiles das aplicações
  dokploy/            um Compose por domínio
plano/                especificações de produto e decisões
```

LaFarmer possui um workspace interno em `apps/lafarmer/`, porque seu cliente
Phaser, servidor Fastify e pacotes de conteúdo têm ciclo de build próprio.

## Desenvolvimento local

Requer Node 22 para as aplicações da raiz. Docker só é necessário para validar
as imagens e os Compose.

```powershell
npm ci
npm run build
npm test
npm run typecheck
```

Para trabalhar em uma aplicação isolada, entre em `apps/<jogo>` e use o README
dela. Para o LaFarmer:

```powershell
Push-Location apps/lafarmer
npm ci
npm run build
npm test
Pop-Location
```

## Adicionando um novo jogo

1. Crie `apps/novo-jogo` com `package.json`, `/healthz`, build e testes.
2. Registre o jogo em `packages/game-catalog`.
3. Adicione o Dockerfile e o Compose em `infra/`.
4. Adicione o README da aplicação e o domínio correspondente.
5. Cadastre o serviço no Dokploy usando este repositório e a branch `staging`;
   depois configure o equivalente de produção apontando para `main`.
6. Valide isolamento de login, estado, WebSocket e banco.

## Fluxo de homologação e deploy

O fluxo oficial é `feature/*` → `staging` → `main`:

- `staging` é a branch de homologação e alimenta o ambiente HML;
- `main` é a branch de produção e só recebe merge depois da validação em HML;
- não se faz deploy de produção a partir de uma branch de feature.

O HML usa os mesmos Compose e Dockerfiles da produção, mas com ambiente,
domínios, secrets e volumes PostgreSQL próprios. A configuração está descrita
em [`infra/dokploy/staging/README.md`](infra/dokploy/staging/README.md).

## Deploy de produção

O deploy oficial ocorre somente a partir da `main`, depois do merge da PR no
GitHub. O Dokploy mantém um único projeto `GameGameGame` com seis serviços:
os cinco serviços de aplicação/banco já existentes e o Compose do LaFarmer.

Cada aplicação usa sua configuração em `infra/dokploy/<jogo>`, a rede externa
`dokploy-network` e o endpoint `/healthz`. WebSocket e frontend compartilham a
mesma origem em produção. O ambiente HML usa os mesmos arquivos, com as
variáveis de [`infra/dokploy/staging/.env.example`](infra/dokploy/staging/.env.example).

Antes de alterar persistência, confirme os volumes PostgreSQL reais no Dokploy.
Os nomes são parametrizados por `CARACOL_POSTGRES_VOLUME` e
`LAFARMER_POSTGRES_VOLUME`; segredos nunca devem entrar no Git.

Consulte [`infra/README.md`](infra/README.md) para o runbook de infraestrutura.
