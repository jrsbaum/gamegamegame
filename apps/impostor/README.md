# Quem é o Impostor

Jogo multiplayer de salas com rodadas, dicas, desenho e acusações. A aplicação
possui frontend React/Vite e servidor Express com Socket.IO no mesmo serviço.

## Desenvolvimento

```powershell
npm install
npm run dev
```

O servidor local usa a porta `3001` por padrão e expõe `/healthz`. O cliente
Vite usa proxy para o servidor. Em produção, o frontend e o Socket.IO usam
`https://impostor.gamegamegame.site` na mesma origem.

## Build, testes e operação

```powershell
npm run typecheck
npm test
npm run build
npm start
```

As salas, partidas e sessões são exclusivas do Impostor. O jogo não acessa o
estado dos demais serviços.

O Compose e o Dockerfile ficam em `infra/dokploy/impostor` e
`infra/docker/gamegamegame.Dockerfile`. O deploy oficial usa a branch `main`.
