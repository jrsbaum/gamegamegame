# Caracol

Jogo React/Vite + Express/Socket.IO em `caracol.gamegamegame.site`. É um
mundo global contínuo, não um conjunto de salas independentes. O servidor
`server/caracol/game.ts` decide movimento, alvo, economia e efeitos.

## Estado e contratos

- `shared/protocol.ts` e `shared/caracol.ts` definem os contratos e conceitos
  usados pelo cliente e servidor.
- `server/caracol/store.ts` mantém as implementações PostgreSQL e em memória.
  Sem `CARACOL_DATABASE_URL` o modo local usa memória; isso não valida
  persistência nem recuperação após reinício.
- Preserve a separação entre estado global do mundo e estado de cada conta.
  Operações que alteram moedas, compras, efeitos ou histórico precisam continuar
  consistentes nos dois stores e transacionais quando mexerem em vários dados.
- Efeitos derivados da localização atual devem continuar sendo calculados a
  partir do estado atual da conta e do mundo, conforme `.specs/STATE.md` AD-006.
- Sessões persistidas armazenam hash do token; nunca grave nem registre o token
  bruto. Veja AD-005 antes de alterar login, logout ou retomada de sessão.
- Push usa chaves VAPID próprias: a chave privada só existe no servidor.

Antes de mexer em preço, efeitos, roleta, tick ou histórico, consulte
`.notebook/caracol-servidor-motor-e-roleta.md` e a feature correspondente em
`.specs/features/`. A nota explica escopos global/conta, liquidação de moedas e
ordenação de mutações; preserve essas regras ao adicionar consumidores. O
`README.md` da aplicação é a referência para variáveis, portas e persistência.

## Comandos e validação

Execute em `apps/caracol`:

- `npm run dev` inicia Vite e servidor.
- `npm run build` compila servidor e web.
- `npm run typecheck` verifica ambos os projetos TypeScript.
- `npm test` executa Vitest, incluindo integração do servidor.
- `npm start` inicia o servidor compilado.
- `npm run splash:caracol` gera o splash quando necessário.

Whoami usa as mesmas portas padrão 5174 e 3001; Impostor também usa o servidor
3001. Rode um servidor por vez ou ajuste as portas e o proxy correspondente.
Validação com store em memória não substitui teste de persistência PostgreSQL.

Produção usa `infra/dokploy/caracol/docker-compose.yml` e
`infra/docker/caracol.Dockerfile`. HML segue a branch `staging` e usa banco,
volume, credenciais e chaves VAPID separados; veja
`infra/dokploy/staging/README.md`.
