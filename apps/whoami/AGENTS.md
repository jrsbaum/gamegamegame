# Quem Sou Eu

Aplicação React/Vite + Express/Socket.IO implantada em
`whoami.gamegamegame.site`. `src/main.tsx` fixa o modo `whoami` e
`server/index.ts` restringe o motor a esse modo.

## Regras do jogo e estado

- `server/game.ts` é a autoridade para sala, rodada, personagem, pontuação,
  dicas e reconexão. As salas ficam em memória; reiniciar o processo as encerra.
- `shared/protocol.ts` é o contrato Socket.IO; mantenha cliente, servidor e
  testes compatíveis quando alterar eventos ou payloads.
- O jogador não pode receber o próprio personagem durante a rodada antes de
  acertá-lo. Preserve essa privacidade na projeção de estado enviada pelo
  servidor; esconder o dado apenas no React não é proteção.
- O relógio exibido deriva de `serverNow` enviado pelo servidor. Mantenha
  contagem, duração e resultado coerentes entre jogadores.
- Nomes e aliases de `server/wordlist.ts` precisam continuar aceitáveis como
  palpites. Não aumente o mínimo de caracteres sem validar o menor nome e
  todos os aliases; um item impossível de acertar pode travar a rodada.

Consulte `.notebook/nucleo-servidor-whoami-impostor.md` para o ciclo da partida,
`.notebook/palpite-vs-catalogo.md` para o vínculo entre catálogo e palpite e
`.specs/STATE.md` para decisões ativas sobre personagens, repetição e relógio.
O `README.md` desta aplicação documenta execução e infraestrutura local.

## Comandos

Execute em `apps/whoami`:

- `npm run dev` inicia Vite e o servidor em watch.
- `npm run build` compila servidor e web.
- `npm run typecheck` verifica os dois projetos TypeScript.
- `npm test` executa os testes, incluindo a integração Socket.IO.
- `npm run test:watch` mantém Vitest em watch.
- `npm start` inicia `dist-server/server/index.js`.

Ao diagnosticar um timeout de evento, confira também o canal `error` e a nota
`.notebook/depurar-timeout-de-socket.md` antes de concluir que a causa é só
lentidão ou aumentar o prazo.

O servidor padrão usa a porta 3001, compartilhada pelos outros jogos; Caracol
também usa Vite 5174. Para desenvolvimento simultâneo, ajuste as portas do
servidor e o proxy do Vite em conjunto.

O serviço usa `infra/dokploy/whoami/docker-compose.yml` e
`infra/docker/gamegamegame.Dockerfile`. Mantenha seu domínio e estado isolados
dos outros serviços.
