# Lobby GameGameGame

Lobby estático que apresenta o catálogo dos quatro jogos e encaminha cada
jogador para o domínio correto. Não possui banco, sessão de jogo nem
WebSocket.

## Desenvolvimento

```powershell
npm install
npm run dev
```

O catálogo exibido pela interface vem de `packages/game-catalog`; ao adicionar
ou remover um jogo, atualize o catálogo tipado e os testes correspondentes.

## Build e testes

```powershell
npm run typecheck
npm test
npm run build
```

O endpoint de saúde publicado é `/healthz` e o domínio de produção é
`https://gamegamegame.site`.

## Deploy

O Compose e o Dockerfile ficam em `infra/dokploy/lobby` e
`infra/docker/lobby.Dockerfile`. O Dokploy deve sempre usar o repositório
`jrsbaum/gamegamegame`, branch `main`, após o merge da PR.
