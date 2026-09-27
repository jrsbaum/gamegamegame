# LaFarmer 2 no Dokploy

O Compose do LaFarmer 2 mantém web, servidor e PostgreSQL separados do
LaFarmer 1. Produção usa `docker-compose.yml`; HML usa
`docker-compose.staging.yml` e o volume externo
`gamegamegame-staging-lafarmer2-postgres`.

No Dokploy, crie um Compose apontando para `infra/dokploy/lafarmer2/docker-compose.yml`,
com o repositório `jrsbaum/gamegamegame`, branch `main`, rede externa
`dokploy-network` e domínio `lafarmer2.gamegamegame.site`. Defina
`DATABASE_URL`, `SESSION_SECRET`, `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `LAFARMER2_POSTGRES_VOLUME` e `WEB_DOMAIN` como secrets ou
variáveis do ambiente. O volume deve ser novo e exclusivo do LaFarmer 2.

Antes da produção, crie o Compose HML com branch `staging`, domínio
`hml-lafarmer2.gamegamegame.site`, volume `gamegamegame-staging-lafarmer2-postgres`,
`LAFARMER2_HML_POSTGRES_PASSWORD` e `LAFARMER2_HML_SESSION_SECRET` distintos.

Valide `/`, `/healthz`, login, `/ws`, criação do perfil e persistência de
posição depois de reiniciar somente o serviço do servidor.
