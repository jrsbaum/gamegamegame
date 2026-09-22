# GameGameGame

Monorepo das cinco aplicações multiplayer da plataforma:

- `gamegamegame.site` — lobby;
- `whoami.gamegamegame.site` — Quem Sou Eu;
- `impostor.gamegamegame.site` — Quem é o Impostor;
- `caracol.gamegamegame.site` — Caracol;
- `lafarmer.gamegamegame.site` — LaFarmer.

Cada jogo tem frontend, servidor, testes e deploy próprios. O login e os
estados continuam isolados por jogo; nenhum serviço compartilha banco com
outro.

## Estrutura

```text
apps/       aplicações executáveis
packages/   contratos e catálogo compartilhados
infra/      Docker e Compose versionados para o Dokploy
plano/      especificações de produto
```

Para adicionar um jogo, crie `apps/novo-jogo`, registre sua definição em
`packages/game-catalog`, implemente `/healthz`, adicione o Dockerfile/Compose
e inclua testes.

## Desenvolvimento

Requer Node 22 e Docker quando for validar as imagens.

```powershell
npm install
npm run build
npm test
```

LaFarmer mantém um workspace interno porque possui Phaser, servidor Fastify e
pacotes de conteúdo próprios. O comando raiz instala e valida esse workspace
automaticamente.

## Deploy

O deploy oficial é feito somente a partir da branch `main`, depois do merge da
PR no GitHub. Cada serviço Dokploy usa o Compose correspondente em
`infra/dokploy/<jogo>` e a rede externa `dokploy-network`.

Antes da migração dos serviços, faça backup e confirme os nomes reais dos
volumes PostgreSQL existentes. Eles são informados por
`CARACOL_POSTGRES_VOLUME` e `LAFARMER_POSTGRES_VOLUME`; os Compose não criam
volumes substitutos.

Consulte [`infra/README.md`](infra/README.md) para a matriz de domínios,
variáveis, healthchecks e validação local.
