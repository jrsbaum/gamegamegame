# LaFarmer — runbook de deploy no Dokploy

Este runbook descreve a configuração esperada. Ele não aplica DNS, não acessa o Dokploy e não contém credenciais.

## Topologia

O arquivo [`infra/dokploy/docker-compose.yml`](../infra/dokploy/docker-compose.yml) sobe três serviços:

- `web`: aplicação web estática servida por Nginx na porta interna `80`;
- `server`: API e WebSocket na porta interna `4000`;
- `postgres`: banco privado, sem porta publicada.

O Traefik/Dokploy termina TLS e encaminha o mesmo domínio para o serviço correto:

- `/api`, `/ws` e `/healthz` → `server`;
- demais rotas → `web`.

O WebSocket deve usar `wss://` em produção. A rede externa compartilhada pelo proxy reverso é `dokploy-network` no ambiente atual do Dokploy.

## Preparação local

1. Copie `infra/.env.example` para `infra/.env`.
2. Ajuste apenas os valores locais, se necessário.
3. A partir da raiz do repositório, valide a composição:

```text
docker compose --env-file infra/.env -f infra/docker-compose.dev.yml config
```

4. Suba o ambiente:

```text
docker compose --env-file infra/.env -f infra/docker-compose.dev.yml up --build
```

O contrato esperado do cliente é o build Vite em `apps/web/dist`; o servidor expõe `GET /healthz` na porta interna `4000`.

## DNS na Namecheap

Use o domínio final aprovado pelo produto; o valor de exemplo abaixo não é um valor de produção.

1. Descubra o IP público do servidor Dokploy.
2. Crie um registro `A` para o host do jogo apontando para esse IP. Exemplo: `lafarmer` → `IP_DO_DOKPLOY` para `lafarmer.gamegamegame.site`.
3. Remova apenas registros conflitantes para o mesmo host; não altere o domínio raiz nem outros jogos.
4. Aguarde a propagação e confirme com `nslookup`/`dig` antes de emitir o certificado.
5. No Dokploy, cadastre o mesmo hostname no serviço web ou na aplicação Compose. O certificado deve ser emitido pelo resolver ACME configurado no proxy.

No ambiente atual, o hostname é `lafarmer.gamegamegame.site`; a validação de DNS já foi confirmada no Dokploy. A emissão do certificado ACME precisa ser validada separadamente antes de considerar o HTTPS encerrado.

## Configuração no Dokploy

1. Crie uma aplicação Compose a partir do repositório e selecione `infra/dokploy/docker-compose.yml` como arquivo.
2. Defina o diretório de build como a raiz do repositório para que `context: ../..` resolva corretamente.
3. Associe o Compose à rede externa `dokploy-network` usada pelo Traefik.
4. Cadastre as variáveis abaixo no ambiente do Dokploy, nunca no Git:

| Variável | Exigência |
|---|---|
| `WEB_DOMAIN` | hostname final, sem `https://` |
| `POSTGRES_DB` | nome do banco |
| `POSTGRES_USER` | usuário do banco |
| `POSTGRES_PASSWORD` | senha forte e única |
| `DATABASE_URL` | URL privada apontando para `postgres:5432` |
| `SESSION_SECRET` | segredo aleatório longo |
| `CORS_ORIGIN` | derivado do domínio; o Compose usa `https://${WEB_DOMAIN}` |

5. Faça o primeiro deploy e verifique os healthchecks.
6. Valide `https://<domínio>/`, `https://<domínio>/healthz` e a conexão `wss://<domínio>/ws` com uma sessão autenticada.

## Persistência e operação

- O volume `lafarmer-postgres` é a fonte de dados do MVP; configure backup do volume/database no Dokploy antes de produção.
- Não publique a porta do PostgreSQL.
- Use logs do `server` para falhas de autenticação, migrações e WebSocket; não registre senhas nem tokens.
- O servidor aplica o schema PostgreSQL de forma idempotente na inicialização; mantenha o backup do volume antes de qualquer atualização estrutural.
- O `SESSION_SECRET` não pode mudar entre reinícios, ou as sessões existentes serão invalidadas.

## Valores que ainda dependem do ambiente

- repositório/branch de produção;
- hostname final e IP do Dokploy;
- existência e nome da rede externa `dokploy-network`;
- resolver ACME e entrypoint HTTPS do Dokploy;
- valores de banco e `SESSION_SECRET`;
- política de backup antes do bootstrap idempotente do schema;
- política de backup e retenção;
- autorização para alterar DNS.
