# Lobby

O lobby é o portal React/Vite da plataforma. Ele exibe e encaminha para os
quatro jogos; não cria salas nem controla autenticação ou estado de partida.

## Fonte dos cartões

- `src/LobbyApp.tsx` renderiza os cartões a partir de `GAME_CATALOG`.
- `packages/game-catalog` é a fonte de IDs, nomes, domínios, status e destinos.
- `packages/platform-contracts` define os tipos e rótulos de status.
- Para incluir ou renomear um jogo, altere o catálogo compartilhado e seus
  testes. Não replique domínio ou status em componentes do lobby.

Cartões ativos são links; jogos em manutenção ou em breve são conteúdo
indisponível, não links falsos. Preserve a semântica de teclado e leitor de
tela ao mudar a apresentação ou o destino.

## Comandos

Execute em `apps/lobby`:

- `npm run dev` inicia o Vite.
- `npm run typecheck` verifica TypeScript.
- `npm test` executa os testes do lobby.
- `npm run build` verifica TypeScript e gera o build.

Ao mudar um contrato do catálogo, valide também `packages/game-catalog` e os
consumidores afetados. Um teste de componente ou build não substitui verificar
o destino final dos links.

Consulte `README.md` para desenvolvimento e `infra/README.md` para deploy. O
Compose e o Dockerfile do lobby são próprios (`infra/dokploy/lobby` e
`infra/docker/lobby.Dockerfile`); preserve `/healthz` e o catálogo HML quando
alterar roteamento ou destinos.
