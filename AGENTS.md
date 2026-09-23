# GameGameGame

## Mapa do repositório

O monorepo contém o lobby e quatro jogos implantados separadamente:

- `apps/lobby`: portal de navegação; os cartões vêm de `packages/game-catalog`.
- `apps/whoami`: Quem Sou Eu, domínio `whoami.gamegamegame.site`.
- `apps/impostor`: Quem é o Impostor, domínio `impostor.gamegamegame.site`.
- `apps/caracol`: mundo multiplayer persistente, domínio `caracol.gamegamegame.site`.
- `apps/lafarmer`: fazenda multiplayer, domínio `lafarmer.gamegamegame.site`.
- `packages/game-catalog`: catálogo, destinos e status dos jogos.
- `packages/platform-contracts`: IDs e contratos da plataforma.
- `infra/dokploy/<app>`: Compose versionado de cada serviço.

Login, salas, sessões e bancos são isolados por aplicação. O estado ativo das
salas de Quem Sou Eu e Impostor fica no processo de cada serviço; não prometa
recuperação após reinício. Caracol e LaFarmer têm PostgreSQL próprio. Não una
autenticação, estado ou banco entre jogos.

## Antes de alterar

- Leia este arquivo e o `AGENTS.md` da aplicação afetada. Confira `git status`
  e preserve alterações locais que não fazem parte da tarefa.
- Leia `.notebook/INDEX.md` e abra apenas as notas relevantes para o fluxo que
  vai mudar. Elas documentam armadilhas investigadas, não substituem o código.
- Para uma funcionalidade, confira as decisões ativas em `.specs/STATE.md` e
  os artefatos da feature relacionada em `.specs/features/<feature>/`.
  `.specs/LESSONS.md` é gerado pelo script do projeto; não o edite diretamente.
- O fluxo de especificação de funcionalidades está em
  `.claude/skills/tlc-spec-driven/SKILL.md`. Use-o conforme seus gatilhos; uma
  alteração puramente documental ou mecânica não precisa de uma spec nova.

## Arquitetura e regras comuns

- Cada app de jogo tem build, servidor, domínio e deploy próprios. Contratos
  compartilhados ficam em `packages/` somente quando forem realmente comuns.
- Quem Sou Eu e Impostor têm cópias independentes do núcleo de sala e rodada.
  Os servidores restringem cada app ao seu modo (`whoami` ou `draw-impostor`).
  Se uma mudança afetar regra comum, inspecione os dois apps e atualize/teste
  ambos quando aplicável. Não presuma que mudar um arquivo sincroniza o outro.
- A partida e os segredos são decididos no servidor. Nunca envie a um jogador
  seu próprio personagem secreto antes da hora, nem a palavra ao Impostor.
  Valide também entradas e permissões recebidas por Socket.IO, WebSocket ou HTTP.
- Preserve os contratos de rede e o endpoint `/healthz`, além dos proxies
  configurados no Vite e dos caminhos usados pelos Compose.
- Caracol tem um mundo global e estado por conta; mantenha esses escopos e as
  operações persistidas coerentes entre o store PostgreSQL e o store em memória.
- LaFarmer é um workspace npm separado em `apps/lafarmer`, com servidor, web e
  pacotes de conteúdo próprios. Não conecte a autenticação ou os dados dele
  aos demais jogos.
- Segredos, senhas, tokens e a chave privada VAPID ficam fora do Git e dos logs.
  Não faça alteração em banco, volume ou serviço de produção sem autorização
  explícita e confirmação atual do alvo.

## Instalação e validação

Use Node 22 na raiz (`.nvmrc`). O workspace LaFarmer aceita Node 20+, mas deve
ser executado com o runtime configurado para esta raiz.

Na raiz:

- `npm ci` instala os workspaces registrados na raiz a partir do lockfile.
- `npm run build` e `npm test` cobrem esses workspaces e também instalam e
  executam LaFarmer pelos scripts dedicados.
- `npm run build:games` e `npm run test:games` cobrem apenas os workspaces da
  raiz, sem LaFarmer.
- `npm run typecheck` também não inclui LaFarmer. O build interno de LaFarmer
  roda TypeScript no servidor e no cliente.

Execute comandos locais no workspace da aplicação. Whoami, Impostor e Caracol
usam servidor na porta 3001 por padrão; Whoami e Caracol também usam Vite na
5174, enquanto Impostor usa 5175. Para executar mais de um ao mesmo tempo,
configure portas distintas e atualize o proxy Socket.IO correspondente.

Rode a validação focada no escopo alterado; para contrato compartilhado ou
infraestrutura, inclua os consumidores afetados. Build e testes locais não
comprovam persistência PostgreSQL real, fluxo visual no navegador nem estado
de produção. Informe claramente o que foi validado.

## Deploy

O fluxo normal é `feature/*` → `staging` → `main`: a branch `staging` alimenta
HML, e a promoção para `main` vem depois de CI verde e smoke test do ambiente.
`main` é produção; não faça deploy de produção a partir de branch de feature.
HML usa secrets e volumes próprios, nunca os de produção. Consulte
`infra/dokploy/staging/README.md` antes de alterar Compose ou homologação.

Use o Compose da aplicação correta em `infra/dokploy/<app>` e a rede existente
`dokploy-network`. Antes de uma mudança de volume ou schema, confirme o nome
real do volume e o backup atual; não crie um volume substituto para os dados
existentes. O deploy de produção ocorre após merge em `main`.
