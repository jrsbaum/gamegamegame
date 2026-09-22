# GameGameGame — ambiente HML

Este ambiente é a homologação persistente do monorepo. Ele acompanha a branch
`staging` e serve para validar uma versão antes da promoção para `main`.

## Serviços

Criar no ambiente `staging` do projeto Dokploy `GameGameGame` os mesmos serviços
da produção, usando os mesmos Compose versionados:

| Serviço | Compose | Domínio HML |
| --- | --- | --- |
| Lobby HML | `../lobby/docker-compose.yml` | `hml.gamegamegame.site` |
| Whoami HML | `../whoami/docker-compose.yml` | `hml-whoami.gamegamegame.site` |
| Impostor HML | `../impostor/docker-compose.yml` | `hml-impostor.gamegamegame.site` |
| Caracol HML | `../caracol/docker-compose.yml` | `hml-caracol.gamegamegame.site` |
| LaFarmer HML | `../lafarmer/docker-compose.yml` | `hml-lafarmer.gamegamegame.site` |

Todos os serviços HML devem usar:

- repositório `jrsbaum/gamegamegame`;
- branch `staging`;
- auto deploy habilitado;
- rede externa `dokploy-network`;
- healthcheck `/healthz`;
- labels Traefik exclusivas do ambiente HML.

O Compose é compartilhado entre os ambientes; os domínios, secrets e volumes
entram pelas variáveis do ambiente no Dokploy.

## Isolamento obrigatório

Antes do primeiro deploy, criar volumes PostgreSQL novos e vazios para HML:

```text
gamegamegame-staging-caracol-postgres
gamegamegame-staging-lafarmer-postgres
```

Nunca apontar HML para os volumes reais de produção. Também devem ser
diferentes as credenciais, `DATABASE_URL`, `SESSION_SECRET`, chaves VAPID e
qualquer segredo de autenticação. O banco HML pode receber seeds e contas de
teste sem afetar jogadores reais.

## Domínio e DNS

Criar registros DNS apontando para o mesmo servidor do Dokploy:

```text
hml.gamegamegame.site
hml-whoami.gamegamegame.site
hml-impostor.gamegamegame.site
hml-caracol.gamegamegame.site
hml-lafarmer.gamegamegame.site
```

Depois configurar TLS e os routers Traefik no ambiente HML. Os routers não
podem reutilizar nomes de produção.

## Fluxo de promoção

1. Abrir PR de `feature/*` para `staging`.
2. Fazer merge somente após CI verde.
3. Aguardar o deploy HML e executar smoke test dos cinco domínios.
4. Testar login, WebSocket, persistência e isolamento dos bancos.
5. Abrir PR de `staging` para `main`.
6. Fazer merge e aguardar o deploy de produção.

## Checklist de validação

- [ ] os cinco serviços HML estão saudáveis;
- [ ] nenhum serviço HML usa volume de produção;
- [ ] cada domínio HML responde com TLS;
- [ ] Lobby abre os quatro jogos HML;
- [ ] WebSocket/Socket.IO conectam na mesma origem;
- [ ] Caracol persiste no banco HML;
- [ ] LaFarmer persiste onboarding e estado no banco HML;
- [ ] nenhum usuário ou dado HML aparece na produção;
- [ ] a PR `staging` → `main` contém somente o que foi aprovado.
