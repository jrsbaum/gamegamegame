# LaFarmer

Workspace npm isolado em `apps/lafarmer`: web Vite/Phaser, servidor
Fastify/HTTP/WebSocket e pacotes de conteúdo. Não compartilha identidade,
banco ou estado com os outros jogos.

## Fontes de verdade e fluxos

- O servidor em `apps/server/src` autoriza identidade e ações de fazenda,
  economia, mercado e mundo. Toda regra de compra, plantio, coleta ou mudança
  persistida precisa ser validada no servidor.
- `packages/content` é a fonte dos catálogos e regras compartilhados pelo
  servidor; `packages/content-client` fornece o que o cliente precisa. Evite
  duplicar catálogos e fórmulas em `apps/web`.
- `apps/web/src` contém rede, fluxo de telas e renderização Phaser. Mantenha
  cliente e contrato HTTP/WebSocket compatíveis, inclusive a reconexão e o
  estado retornado após login.
- A escolha da próxima tela após login deve considerar o perfil persistido:
  teste conta nova, perfil incompleto e perfil já concluído. Não envie quem já
  concluiu o onboarding de volta à confirmação inicial.
- A autenticação usa nick único e senha de pelo menos oito caracteres; no
  registro o jogador confirma que guardou as credenciais. Não adicione e-mail
  ou recuperação automática sem decisão de produto.
- Consulte `.notebook/lafarmer-visao-geral.md` para regras de crescimento,
  economia online/offline, mundo e topologia.

## Comandos

Execute a partir de `apps/lafarmer`:

- `npm ci` instala este workspace separado.
- `npm run build` compila conteúdo, servidor e cliente; também faz typecheck.
- `npm test` executa testes dos workspaces e o teste de layout.
- `npm run dev:web` inicia o cliente.
- `npm run dev:server` inicia o servidor.
- Não há script `typecheck` neste workspace; use `npm run build` para verificar
  as compilações TypeScript.

As chamadas locais entre cliente, API e WebSocket dependem do `PORT` e da
configuração Vite/Nginx/Compose. Confira `infra/` e `docs/deploy-dokploy.md`
antes de alterar portas, rotas ou proxy. O modo in-memory de teste não comprova
persistência PostgreSQL.

## Dados e deploy

Antes de alterar schema ou persistência, leia `apps/server/src/postgres-store.ts`
e o runbook de deploy; preserve o volume existente e faça backup antes de
qualquer operação estrutural. O deploy oficial é feito após o merge da PR em
`main`. Nunca coloque credenciais, tokens ou segredos no repositório.
