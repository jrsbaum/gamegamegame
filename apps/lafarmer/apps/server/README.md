# LaFarmer server

Servidor MVP em TypeScript com Fastify para HTTP e `ws` para o canal autenticado em `/ws`.

## Desenvolvimento

```bash
npm install
npm test
npm run build
npm run dev
```

Persistência é selecionada automaticamente: fora de testes, `DATABASE_URL` ativa PostgreSQL; sem essa variável, ou com `NODE_ENV=test`, o servidor usa o adaptador in-memory. O schema PostgreSQL é criado de forma idempotente no hook de inicialização do Fastify.

Variáveis principais:

- `DATABASE_URL`: URL PostgreSQL. Se ausente, usa memória.
- `DATABASE_POOL_MAX`: máximo de conexões do pool; padrão `10`.
- `NODE_ENV`: com valor `test`, força memória mesmo que `DATABASE_URL` exista.
- `PORT`: porta HTTP/WebSocket; padrão `3337`.
- `HOST`: bind do servidor; padrão `0.0.0.0`.
- `CORS_ORIGIN`: origem permitida pelo CORS simples do servidor.

O adaptador in-memory continua disponível em `createInMemoryRepositories()` para testes e desenvolvimento sem banco. As interfaces em `src/repositories.ts` permanecem o contrato comum aos dois adaptadores.

### HTTP

- `GET /healthz`
- `GET /api/catalog`
- `POST /api/auth/register` com `{ nick, password, credentialsSaved: true }`
- `POST /api/auth/login` com `{ nick, password }`
- `GET /api/me` com `Authorization: Bearer <token>`
- `PATCH /api/player/profile` com `{ name, clothing, hair }`
- `GET /api/world/snapshot` com `Authorization: Bearer <token>`
- `GET /api/farm`, `POST /api/farm/plant`, `POST /api/farm/adopt`, `POST /api/farm/:id/care`, `POST /api/farm/:id/harvest` e `POST /api/farm/:id/collect`
- `GET /api/market`, `POST /api/market/listings` e `POST /api/market/:id/buy` (a compra exige `Idempotency-Key` ou `{ idempotencyKey }`)

### WebSocket

Conecte em `/ws?token=<token>`. O servidor envia `hello` com jogadores, entidades e anúncios, aceita `snapshot.get` para uma nova fotografia autoritativa e envia `snapshot` depois de mutações. Os comandos usam `{ type, payload }`: `move`, `farm.plant`, `farm.adopt`, `farm.care`, `farm.harvest`, `farm.collect`, `market.list` e `market.buy` (este último com `idempotencyKey`). A posição, moedas, inventário e ações sempre são validados no servidor.

O adaptador PostgreSQL cria o schema de contas, sessões, jogadores, plantios, anúncios e recibos de compra de forma idempotente. Listagem e compra usam transação; a compra trava os jogadores, remove o anúncio uma vez e guarda o recibo para retries. Online rende 10 moedas por minuto; offline rende 1 moeda por minuto, limitado a 24 horas. Rate limiting, rotação/revogação de sessão, observabilidade avançada e uma migração versionada continuam como endurecimento pós-MVP.
