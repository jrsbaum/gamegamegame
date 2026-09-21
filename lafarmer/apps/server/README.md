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

### WebSocket

Conecte em `/ws?token=<token>`. O servidor envia `hello` e aceita `{ type: "move", actionId, direction }`. O `actionId` torna o movimento idempotente e a posição sempre é atualizada no servidor.

Em produção ainda faltam o adaptador PostgreSQL, rate limiting, rotação/revogação de sessão, observabilidade e regras completas de colisão/mapa.
