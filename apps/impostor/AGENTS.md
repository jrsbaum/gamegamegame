# Quem é o Impostor

Aplicação React/Vite + Express/Socket.IO implantada em
`impostor.gamegamegame.site`. `src/main.tsx` fixa o modo `draw-impostor` e
`server/index.ts` restringe o motor a esse modo.

## Regras do jogo e privacidade

- `server/game.ts` decide a palavra, os turnos, as tentativas e o resultado.
  O impostor recebe a categoria, nunca a palavra durante a rodada.
- A palavra não pode ser enviada ao cliente do impostor e depois apenas
  escondida na interface. Preserve o filtro no estado produzido pelo servidor.
- `shared/protocol.ts` é o contrato Socket.IO. Alterações de evento ou payload
  precisam manter cliente, servidor e testes alinhados.
- Desenhos, acusações, palpites e encerramento devem respeitar as regras do
  servidor, inclusive para cliente desconectado ou payload inválido.
- Este app tem uma cópia independente do núcleo de sala/rodada presente em
  `apps/whoami`. Se mudar uma regra comum aos dois jogos, confira e valide os
  dois apps; mudanças exclusivas do modo desenho ficam neste app.
- A árvore também contém arquivos com nomes de outros jogos. Antes de removê-los
  ou refatorá-los, confirme o grafo de imports e o uso no build; o nome do
  arquivo sozinho não prova que o código está morto.

Consulte `.notebook/nucleo-servidor-whoami-impostor.md` para regras de
visibilidade, turnos e fim da rodada. O `README.md` desta aplicação documenta
execução e infraestrutura local.

## Comandos

Execute em `apps/impostor`:

- `npm run dev` inicia Vite e o servidor em watch.
- `npm run build` compila servidor e web.
- `npm run typecheck` verifica os dois projetos TypeScript.
- `npm test` executa os testes, incluindo o fluxo de desenho.
- `npm run test:watch` mantém Vitest em watch.
- `npm start` inicia o servidor compilado.

O Vite usa a porta 5175 e o servidor usa 3001 por padrão. Outros jogos também
usam o servidor 3001; ajuste a porta e o proxy Socket.IO antes de executá-los
em paralelo.

O Compose é `infra/dokploy/impostor/docker-compose.yml` e o Dockerfile é
`infra/docker/impostor.Dockerfile`. Preserve o escopo fixo do serviço para
`draw-impostor`; não dependa de variável manual do Dokploy para selecionar o
jogo.
