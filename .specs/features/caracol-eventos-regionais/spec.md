# Eventos Regionais do Caracol Specification

## Problem Statement

O Caracol persegue jogadores num mapa do Brasil onde cada cidade tem clima, bioma e cultura reais,
mas o jogo hoje ignora tudo isso: chove ou faz seca em qualquer lugar, tanto faz. Queremos que os
27 estados (26 mais o Distrito Federal) tenham vida própria — clima e fenômenos que mudam sozinhos
e afetam o caracol ou os jogadores que estão ali, do mesmo jeito que a roleta hoje entrega buffs e
nerfs, mas amarrado à geografia real do país. O material de referência completo (bioma, clima,
fenômeno e os ~50 eventos propostos por estado, com fontes) está em `plano/eventos-regionais-clima-brasil.md`
e `plano/eventos-clima-proposta-completa.md`; esta spec formaliza o que dali vira comportamento
testável do sistema.

## Goals

- [ ] Cada um dos 27 estados tem seu próprio clima que liga e desliga sozinho, sem depender da
      roleta existente (giro de 24h) nem de ação do jogador.
- [ ] Todo evento ativo produz um efeito real no jogo (velocidade do caracol, preço, visibilidade,
      saldo ou escudo), reaproveitando o sistema de efeitos que já existe (`caracol_effects`).
- [ ] O catálogo completo do brainstorm (~50 eventos, incluindo os 3 que pedem mecanismo novo)
      entra nesta versão, com os itens marcados ⚠️ (ligados a comunidade indígena ou quilombola
      nomeada) permanentemente fora do catálogo.
- [ ] Um reinício do processo (deploy, crash) não apaga eventos regionais ativos — mesma lição
      aprendida com o bug de sessão do Caracol corrigido nesta mesma sessão de trabalho.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Qualquer evento usando os itens marcados ⚠️ no material de referência (festival indígena nomeado, quilombo histórico específico, moldura étnica de "cultura gaúcha"/imigração de SC) | Decisão já tomada: nenhum enquadramento desses vira mecânica de jogo sem decisão explícita futura do dono do projeto |
| Evento "regional amplo" que liga vários estados de uma vez (ex: seca do Centro-Oeste inteira) | Ideia extra registrada no material de referência, fora do escopo "por estado" desta spec; avaliação separada se decidido depois |
| UI/arte nova para exibir o evento no mapa (ícone de clima, animação, texto) | Este documento cobre a mecânica de servidor; a camada visual é um passo de design separado. Quando esse passo acontecer, segue o design system já estabelecido no jogo (mesmos tokens, componentes e padrões visuais já em uso no Caracol) — nenhuma linguagem visual nova sem necessidade |
| Alterar a roleta existente (giro de 24h, 13 itens) | Sistema paralelo e independente, não deve tocar no código da roleta além de reusar o tipo de efeito |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | --------------- | --------- | ---------- |
| Escopo da v1 | Todos os ~50 eventos do brainstorm, incluindo os 3 que pedem mecanismo novo | Decisão explícita do dono do projeto | y |
| Tick de reavaliação | 30 minutos por estado | Decisão explícita do dono do projeto | y |
| Teto de estados simultâneos com evento ativo | 4 dos 27 | Decisão explícita do dono do projeto | y |
| Empilhamento de eventos no mesmo estado | No máximo 1 evento ativo por estado; um evento elegível não interrompe o que já está ativo, só entra quando o atual expira naturalmente | Decisão explícita do dono do projeto (não empilhar); a regra de "não interromper" é escolha minha para manter previsibilidade — sem isso, um evento raro poderia cortar um sazonal no meio, complicando o teste de duração | y (não empilhar) / assumido (não interromper) |
| Persistência entre restart | Sim, estado ativo de cada região persiste no Postgres e recarrega no boot | Decisão explícita do dono do projeto, espelhando a correção do bug de sessão (AD-005, `.specs/STATE.md`) desta mesma sessão | y |
| Seleção de quais estados ativam quando há mais elegíveis que o teto | Amostragem aleatória ponderada, favorecendo estados que ficaram mais tempo sem evento ativo | Evita que o mesmo punhado de estados monopolize os eventos; nenhuma decisão explícita do dono sobre o algoritmo exato, escolhido por analogia ao sorteio 50/50 já testável da roleta | n — assumido |
| Notificação de início/fim de evento | Transmite `caracol:notice` nomeando o estado e o evento | Mesma UX já usada para avisos globais (giro de outro jogador, etc); nenhuma decisão explícita, mas seguir o padrão existente é o caminho de menor risco | n — assumido |
| Fonte de dados do catálogo | Um catálogo de dados no servidor (não o `.md` de prosa), com os 50 eventos descritos nos documentos de `plano/` traduzidos para uma estrutura validável por teste, no mesmo espírito de `CARACOL_ROULETTE_CATALOG` | O `.md` é prosa para aprovação humana, não uma fonte executável; precisa de uma estrutura de dados testável | n — assumido |
| Bônus "disparável" (Oktoberfest) | Uma vez por conta por ocorrência da janela do evento; segunda tentativa falha com erro específico, sem creditar de novo | Sem essa regra, o mecanismo novo criaria uma fonte infinita de moedas | n — assumido |
| Efeito "ambos" (afeta caracol e jogador ao mesmo tempo) | As duas partes do efeito ativam e desativam juntas, no mesmo commit | Simplifica o ciclo de vida; nenhum evento do catálogo pede que as partes tenham durações diferentes | n — assumido |

**Open questions:** none - all resolved or logged above.

---

## User Stories

### P1: Motor genérico de clima regional ⭐ MVP

**User Story**: Como jogador do Caracol, quero que cada estado tenha um clima que muda sozinho e
produz um efeito real no jogo, para que o mapa pareça vivo, mesmo antes do catálogo completo de 50
eventos estar populado.

**Why P1**: É a fundação — tick, seleção de estados, ciclo de vida do efeito, persistência e
notificação. Sem isso, nenhum evento específico (P2) funciona.

**Acceptance Criteria**:

1. WHEN o relógio do servidor avança 30 minutos desde a última avaliação de clima THEN o sistema
   SHALL reavaliar a elegibilidade de cada um dos 27 estados com base na janela do calendário atual
   e nas condições do catálogo.
2. WHEN mais de 4 estados estão elegíveis para ativar um evento no mesmo ciclo THEN o sistema SHALL
   ativar no máximo 4, nunca mais.
3. WHEN um estado já tem um evento ativo e sua duração ainda não expirou THEN o sistema SHALL
   manter esse evento intacto, mesmo que outro evento do mesmo estado se torne elegível nesse
   meio-tempo (não empilha, não interrompe).
4. WHEN a duração de um evento ativo expira THEN o sistema SHALL desativá-lo, encerrar o(s)
   efeito(s) associado(s) pelo mesmo ciclo de vida já usado por `caracol_effects`, e tornar o
   estado elegível de novo a partir do próximo ciclo.
5. WHEN um evento ativa ou desativa em um estado THEN o sistema SHALL transmitir um
   `caracol:notice` nomeando o estado e o evento.
6. WHEN o processo do servidor reinicia THEN qualquer evento regional que estava ativo (e seu
   horário de expiração) SHALL ser recarregado do Postgres e continuar valendo exatamente como
   antes do reinício.
7. IF um evento tem alvo "ambos" THEN o sistema SHALL ativar a parte pessoal (jogador) e a parte
   global (caracol) atomicamente no mesmo commit, e desativar as duas juntas quando expirar.
8. The system SHALL validar, na subida do processo, que todo item do catálogo tem: um id de estado
   válido, uma janela de elegibilidade bem formada, um alvo entre `caracol`/`jogador`/`ambos`, um
   efeito mapeado para um lever existente ou um dos 3 mecanismos novos aceitos, e uma duração
   positiva ou uma contagem de carga definida. IF qualquer item falhar essa validação THEN o
   sistema SHALL recusar subir com um erro descritivo (mesmo padrão de `wordlist.ts`/
   `drawing-wordlist.ts`, que já recusam subir com catálogo inválido).

**Independent Test**: com um catálogo reduzido de 2-3 eventos de teste (sem esperar o catálogo
completo de P2), simular várias horas de relógio controlado e verificar que estados ativam,
respeitam o teto de 4, expiram na hora certa, e sobrevivem a um "restart" (novo `CaracolGameManager`
sobre o mesmo store, como já fizemos no teste de sessão).

---

### P2: Catálogo completo dos ~50 eventos

**User Story**: Como dono do projeto, quero que os eventos concretos descritos em
`plano/eventos-clima-proposta-completa.md` estejam todos implementados como dados do catálogo, para
que a experiência combine com o que foi aprovado.

**Why P2**: É o conteúdo que dá sentido ao motor de P1 — sem os dados, o sistema genérico não tem
o que mostrar.

**Acceptance Criteria**:

1. WHEN o catálogo é carregado THEN o sistema SHALL conter exatamente os eventos descritos nos
   documentos de `plano/` para os 27 estados, respeitando os alvos, efeitos, janelas e durações lá
   registrados (com arredondamento razoável onde a proposta usa uma faixa, ex: "2-4h").
2. IF um item do material de referência está marcado ⚠️ THEN esse item SHALL NOT aparecer como
   entrada do catálogo.
3. WHEN dois eventos do mesmo estado têm perfis diferentes (sazonal e raro) THEN ambos SHALL
   existir como entradas separadas no catálogo, com o perfil sazonal usando janela de meses sem
   sorteio e o perfil raro usando chance por hora dentro da janela.

**Independent Test**: um teste percorre o catálogo inteiro e confirma a contagem de eventos por
estado e por região bate com a tabela do material de referência; testes pontuais verificam 3-4
eventos específicos (ex: "Cheia do Pantanal" no Mato Grosso do Sul tem alvo `ambos` e persiste a
estação inteira).

---

### P3: Os 3 mecanismos novos

**User Story**: Como jogador do Caracol, quero que a seca do Ceará, os Lençóis Maranhenses/ZCAS de
Minas e a Oktoberfest de Santa Catarina funcionem exatamente como descrito na proposta aprovada, não
como uma versão simplificada que reusa um lever existente.

**Why P3**: São os únicos 3 eventos, entre 50, que não cabem no sistema de efeitos atual — exigem
extensão pontual dele.

**Acceptance Criteria**:

1. WHEN o evento de seca do Ceará está ativo para o estado do jogador THEN a distância/horário
   estimado de chegada do caracol exibido para esse jogador SHALL aparecer arredondado a uma faixa
   grosseira (não o valor exato), enquanto os demais campos do estado permanecem exatos.
2. WHEN o alvo atual do caracol está localizado num estado com um evento de "velocidade por
   localização" ativo (Minas Gerais ou Maranhão) THEN a velocidade de perseguição contra esse alvo
   SHALL aplicar o multiplicador do evento, sem exigir que o alvo possua nenhum item.
3. WHEN um jogador está no estado de Santa Catarina durante a janela ativa do evento da Oktoberfest
   THEN uma ação de resgate SHALL creditar o bônus fixo uma única vez por conta por ocorrência da
   janela. IF a mesma conta tentar resgatar de novo na mesma janela THEN o sistema SHALL recusar
   com um código de erro específico, sem creditar de novo.

**Independent Test**: testes de integração isolados para cada um dos 3 mecanismos, incluindo o
caso de resgate duplo da Oktoberfest sendo recusado.

---

## Edge Cases

- IF a janela de um evento cruza a virada do ano (ex: dezembro a março) THEN a checagem de
  elegibilidade SHALL considerar o mês atual corretamente nos dois lados da virada.
- IF nenhum evento do catálogo está elegível para um estado no momento da checagem THEN esse
  estado SHALL simplesmente não ter evento ativo (não é um erro, é o estado normal na maior parte
  do tempo).
- WHEN um jogador muda de cidade (e portanto de estado, via Cogumelo) enquanto um efeito pessoal de
  evento regional está aplicado nele THEN esse efeito pessoal SHALL parar de valer para o estado
  antigo; se o novo estado tiver evento ativo, o efeito dele passa a valer a partir da próxima
  leitura de estado.
- IF o catálogo tiver duas entradas para o mesmo estado com janelas de meses que se sobrepõem e
  ambas do tipo raro THEN o sistema SHALL escolher entre as elegíveis por ordem de definição no
  catálogo (a primeira que sortear ativa; não ativa duas ao mesmo tempo, conforme a regra de não
  empilhar).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --------------- | ----------- | ------ | ------- |
| REGCLIM-01 | P1: tick de 30min reavalia elegibilidade | Design | Pending |
| REGCLIM-02 | P1: teto de 4 estados simultâneos | Design | Pending |
| REGCLIM-03 | P1: não empilha, não interrompe | Design | Pending |
| REGCLIM-04 | P1: expiração e ciclo de vida do efeito | Design | Pending |
| REGCLIM-05 | P1: notificação de início/fim | Design | Pending |
| REGCLIM-06 | P1: persistência e reload após restart | Design | Pending |
| REGCLIM-07 | P1: alvo "ambos" atômico | Design | Pending |
| REGCLIM-08 | P1: validação do catálogo no boot | Design | Pending |
| REGCLIM-09 | P2: catálogo completo fiel ao material de referência | Design | Pending |
| REGCLIM-10 | P2: itens ⚠️ nunca entram no catálogo | Design | Pending |
| REGCLIM-11 | P2: perfis sazonal e raro coexistem como entradas distintas | Design | Pending |
| REGCLIM-12 | P3: ETA borrado (Ceará) | Design | Pending |
| REGCLIM-13 | P3: velocidade por localização do alvo (MG/MA) | Design | Pending |
| REGCLIM-14 | P3: bônus resgatável idempotente (Oktoberfest) | Design | Pending |

**ID format:** `REGCLIM-NN`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 14 total, 14 a mapear em tasks depois da fase de Design

---

## Success Criteria

- [ ] Um catálogo de teste pequeno (2-3 eventos) prova o motor genérico funcionando de ponta a
      ponta: ativa, expira, respeita o teto, sobrevive a restart.
- [ ] O catálogo completo de ~50 eventos carrega sem erro de validação e bate em contagem com o
      material de referência de `plano/`.
- [ ] Os 3 mecanismos novos têm teste de integração isolado, incluindo o caso de resgate duplo
      sendo recusado.
- [ ] Nenhum item marcado ⚠️ aparece em nenhum teste ou no catálogo.
