# STATE

## Decisions

### AD-001
- **Decision**: Os nomes do catálogo usam a forma da localização oficial brasileira; o nome original em inglês vira alias de palpite e nunca é exibido.
- **Reason**: O jogo é falado em português, mas parte dos personagens é conhecida no Brasil pelo próprio nome em inglês (`Batman`, `Goku`, `Luke Skywalker`). Traduzir à força produziria nomes que ninguém reconhece e tornaria o jogo mais difícil sem ganho nenhum.
- **Trade-off**: A regra não é mecânica — exige julgamento caso a caso e verificação na Wikipédia PT quando a forma brasileira é incerta. Um script não consegue validar "é o nome que o brasileiro usa"; o teste automatizado só garante que nenhum original em inglês sobrou como nome exibido.
- **Scope**: `server/wordlist.ts` e qualquer feature futura que adicione personagens ao catálogo.
- **Date**: 2026-08-04
- **Status**: active

### AD-002
- **Decision**: Personagens já atribuídos são rastreados por sala (`RoomState.usedCharacterIds`) e o catálogo é reciclado quando os disponíveis não bastam para os jogadores presentes.
- **Reason**: Repetir um personagem na mesma sala entrega a resposta ao grupo. Rastrear por sala mantém salas independentes entre si, e reciclar evita travar o jogo de um grupo que jogou muitas rodadas.
- **Trade-off**: O estado da sala cresce um `Set` por sala e o "sem repetição" deixa de ser absoluto — após o esgotamento os personagens voltam a circular. Aceito porque esgotar exige ~24 rodadas na mesma sala com 12 jogadores.
- **Scope**: `server/game.ts` (`RoomState`, `startRound`), `server/wordlist.ts` (`pickCharacters`).
- **Date**: 2026-08-04
- **Status**: active

### AD-003
- **Decision**: Toda duração e todo instante exibidos derivam do relógio do servidor. O servidor envia `roundStartedAt` e `serverNow` em cada `RoomView`; o cliente calcula a defasagem uma vez por payload e só faz a contagem visual.
- **Reason**: O relógio da máquina do jogador pode estar errado em minutos ou horas. Se o cliente calculasse a duração com o próprio `Date.now()`, dois jogadores da mesma sala veriam tempos diferentes e o tempo de acerto registrado seria inauditável.
- **Trade-off**: `serverNow` viaja em todo payload de estado (8 bytes de JSON) e a defasagem carrega a latência de ida do pacote — erro de dezenas de milissegundos, muito abaixo do 1s exigido pelo spec.
- **Scope**: `shared/protocol.ts`, `server/game.ts`, `src/App.tsx` e qualquer feature futura que exiba tempo.
- **Date**: 2026-08-04
- **Status**: active

### AD-004
- **Decision**: O crédito de autor, fonte e licença das imagens deixa de ser exibido na interface. Removido do card da rodada (`character-credit`) e da tela de revelação (`reveal-credit`), junto de `creditLabel`, `ComicVineLink` e das regras de estilo correspondentes. Não há seção de créditos substituta.
- **Reason**: Decisão do dono do projeto por motivo visual — o bloco de três linhas em fonte mono dentro do card pesava demais. A alternativa de manter o crédito só na tela de revelação foi apresentada e recusada.
- **Trade-off**: Aceito com o risco declarado. As imagens do Wikimedia Commons sob CC BY e CC BY-SA **exigem** atribuição, e os termos da API do Comic Vine exigem link de volta ao site sempre que os dados aparecem na interface. Sem crédito exibido em lugar nenhum, o jogo passa a usar essas imagens fora das condições da licença. Isso também revoga na prática IMG-06 da spec `fotos-personagens` ("WHEN uma imagem aprovada exigir atribuição THEN a interface SHALL exibir autor e licença de forma acessível") — a spec fica desatualizada em relação ao código até que alguém a corrija. Os metadados de autor e licença continuam gravados em `server/character-images.ts`, então repor a exibição é barato se a decisão mudar.
- **Scope**: `src/App.tsx`, `src/styles.css`, e a spec `.specs/features/fotos-personagens/spec.md` (IMG-06 agora divergente).
- **Date**: 2026-08-09
- **Status**: active

### AD-005
- **Decision**: Sessões do Caracol (`caracol:resume`) passam a ser persistidas no Postgres (`caracol_sessions`, hash do token + accountId), não só em memória. Sem expiração automática — mesmo comportamento de hoje, só que sobrevive a restart.
- **Reason**: `CaracolGameManager.sessions` era um `Map` só em memória, nunca recarregado do snapshot. Qualquer reinício do processo (deploy, crash, hibernação/wake do Render) zerava o mapa inteiro; o próximo `caracol:resume` de qualquer jogador caía em `SESSION_EXPIRED`, mesmo com a conta intacta no banco. As duas queixas do dono do projeto ("sessão expira sozinha" e "deploy desloga todo mundo") tinham a mesma causa raiz.
- **Trade-off**: Sessão nunca expira sozinha — um token vazado ou um dispositivo perdido continua válido até logout explícito. Aceito porque o jogo já não tem recuperação de senha nem multiconta por natureza; adicionar TTL fica fácil de acrescentar depois (`created_at` já é gravado).
- **Scope**: `server/caracol/store.ts` (`caracol_sessions`, `CaracolStore.createSession/deleteSession`), `server/caracol/game.ts` (`initialize()`, `issueSession()`, `revokeSession()`).
- **Date**: 2026-09-21
- **Status**: active

## Handoff
- **Feature**: powerup-de-dica (`.specs/features/powerup-de-dica/`) — **concluída**
- **Phase / Task**: 3 fases, 11 tasks (T1..T11) + 3 correções; 2 rodadas de Verifier; veredito PASS, 8/8 mutantes mortos
- **Completed**: servidor `1178053`, `bc4c1d8`, `485630b`, `efeddf7`, `164d395`, `77e7f4a`; interface `a49b806`, `44d4ded`, `3b1ec2d`, `3cb1f44`, `d27bc98`; correções `23fea84`, `a369208`, `ce4ad2c`; spec+tasks `c3c0985`
- **In-progress** (file:line): none
- **Next step**: decidir sobre o flake de socket (abaixo). Depois, UAT interativo acumulado e merge da branch `feat/powerup-de-dica` em `main`.
- **Blockers**: none
- **Uncommitted files**: none
- **Branch**: feat/powerup-de-dica (local, não enviada; parte de `main`)
- **Decisão de desenho registrada**: a concessão de power-ups é **derivada, nunca agendada** — `shared/hints.ts` é a fonte única dos marcos de 30/40/50 e do teto de 3, e cliente e servidor a chamam. Isso preserva a guarda TIME-09, que assere um único agendador em `server/game.ts`. Qualquer feature futura que dependa de tempo deve seguir o mesmo caminho.
- **PROBLEMA ABERTO — flake de socket**: `tests/game.integration.test.ts` falha por `Timeout esperando <evento>` de forma intermitente, em testes variados e pré-existentes (já visto em POOL-01/02, SCORE-01, SCORE-06, SCORE-09, END-16 e no teste de privacidade). Chegou a ~1 em 4 execuções durante esta feature e caiu para 0 em 4 na verificação final, sem que nada no código explicasse a diferença — ou seja, está **latente, não resolvido**. A suíte de integração cresceu de 49 para 68 testes contra um Socket.IO real, com `waitForEvent` de timeout fixo em 15s e `testTimeout` de 30s. Com falso vermelho recorrente o gate deixa de distinguir falha real de ruído. Precisa de decisão própria: investigar contenção/paralelismo do vitest, ou aumentar prazos, ou isolar a suíte de integração.
