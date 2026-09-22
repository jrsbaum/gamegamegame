# Caracol

Aplicação independente do modo Caracol do GameGameGame. Este diretório contém
o frontend React/Vite, o servidor Express + Socket.IO, os contratos do jogo, o
store PostgreSQL/in-memory, autenticação por nick e senha, notificações Push
com VAPID, service worker, assets do mapa e os testes do modo.

## Desenvolvimento

```bash
npm install
npm run dev
```

O Vite abre em `http://localhost:5174` e encaminha Socket.IO/healthcheck para
o servidor em `http://localhost:3001`. Sem `CARACOL_DATABASE_URL`, o servidor
usa o store em memória; para persistência, defina essa variável para um
PostgreSQL. Os nomes das tabelas `caracol_accounts`, `caracol_world`,
`caracol_history`, `caracol_effects` e `caracol_push_subscriptions` são os
mesmos da aplicação original.

Para Push, gere um par exclusivo com `npx web-push generate-vapid-keys` e
defina `CARACOL_VAPID_PUBLIC_KEY`, `CARACOL_VAPID_PRIVATE_KEY` e, opcionalmente,
`CARACOL_VAPID_SUBJECT` somente no ambiente do servidor. A chave pública é
entregue pelo snapshot autenticado; a privada nunca vai para o frontend.

## Build e testes

```bash
npm test
npm run typecheck
npm run build
npm start
```

`npm run build` gera `dist/` e `dist-server/` dentro desta aplicação. O
servidor serve o frontend quando `dist/index.html` existe e expõe `/healthz`
mais o Socket.IO do Caracol. `VITE_SERVER_URL` é lida no build para permitir
frontend e servidor em domínios diferentes; vazia, o cliente usa a mesma
origem.

## Dependências necessárias

As dependências de runtime são React/ReactDOM, Express, Socket.IO, `pg`,
`bcryptjs` e `web-push`. As de desenvolvimento são TypeScript, Vite, Vitest,
tsx, o plugin React e os tipos Node/Express/pg/React/web-push. Esta aplicação
possui seu próprio `package.json` e lockfile e não depende do `package.json`
raiz, do lobby, dos modos Quem Sou Eu/Impostor ou do app LaFarmer.
