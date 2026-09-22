# Quem Sou Eu

Jogo multiplayer de salas do GameGameGame. A aplicação possui frontend
React/Vite e servidor Express com Socket.IO no mesmo serviço publicado.

## Desenvolvimento

```powershell
npm install
npm run dev
```

O servidor local usa a porta `3001` por padrão e expõe `/healthz`. O cliente
Vite usa proxy para o servidor durante o desenvolvimento. Em produção,
frontend, HTTP e Socket.IO usam `https://whoami.gamegamegame.site` na mesma
origem.

## Build, testes e operação

```powershell
npm run typecheck
npm test
npm run build
npm start
```

As salas e sessões pertencem exclusivamente ao Quem Sou Eu. Não há banco
compartilhado com o Lobby, Impostor, Caracol ou LaFarmer.

O Compose e o Dockerfile ficam em `infra/dokploy/whoami` e
`infra/docker/gamegamegame.Dockerfile`. O deploy oficial usa a branch `main`.
