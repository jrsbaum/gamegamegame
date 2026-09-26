# Casa por dentro — Specification

## Problem Statement

LaFarmer representa a fazenda e a vizinhança, mas a casa atual é apenas um prédio desenhado no mapa. O jogador não pode entrar em um espaço doméstico para relaxar, mostrar que está trabalhando em casa ou receber visitas.

## Goals

- [ ] Criar uma casa inicial gratuita e persistente para cada jogador com região residencial.
- [ ] Permitir que o dono e visitantes autorizados compartilhem o interior sem misturar presença com o mapa externo.
- [ ] Dar interações sociais e de interpretação sem alterar economia ou progressão.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Comprar móveis, ampliar cômodos ou guardar itens | A primeira versão usa planta e conjunto inicial fixos. |
| Bônus de energia, moedas ou produção por trabalhar ou descansar | Trabalho e descanso são interações de interpretação. |
| Chat ou convites privados dentro da casa | A porta aberta/fechada é o controle de acesso definido para esta versão. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Momento de criação | Criar a casa ao primeiro snapshot depois de selecionar uma região; criar sob demanda para casas antigas visitadas | Cadastro inicial não tem região residencial; criação é idempotente | y |
| Movimento interior ao reconectar | Remover ocupação e retornar à porta da casa do próprio jogador | Ocupação/poses são transitórias; posição persistida continua externa | y |
| Edição da planta | Reposicionar somente os móveis iniciais, em uma grade fixa | Evita inventário/loja e mantém escopo da v1 | y |
| Rádio acionado por visitantes | Qualquer ocupante pode tocar; todos na mesma casa recebem a reprodução | Reforça a interação social solicitada | y |
| Áudio bloqueado pelo navegador | Ignorar a reprodução sem interromper o jogo | Alguns navegadores exigem interação local antes de áudio remoto | y |
| Interações de trabalho/descanso | A pose termina ao sair da estação ou desconectar; não concede recompensa | Mantém o espaço como interpretação sem exploração econômica | y |

**Open questions:** none - all resolved or logged above.

## User Stories

### P1: Ter e visitar uma casa ⭐ MVP

**User Story**: Como jogador, quero entrar na minha casa ou em uma casa aberta de outra pessoa para ter um espaço compartilhado de descanso.

**Why P1**: É a experiência central desta feature.

**Acceptance Criteria**:

1. WHEN um jogador com região residencial recebe seu primeiro snapshot THEN o sistema SHALL criar uma casa gratuita com porta aberta e móveis iniciais se ainda não existir uma casa para ele.
2. WHEN uma casa já existente recebe a inicialização da feature THEN o sistema SHALL manter uma única casa por proprietário sem cobrar moedas.
3. WHEN um jogador autorizado entra pela porta THEN o sistema SHALL colocá-lo na instância da casa daquele proprietário e enviar um snapshot apenas aos ocupantes daquela casa.
4. IF a porta está fechada e o jogador não é o dono THEN o sistema SHALL negar a entrada sem alterar posição, ocupação ou persistência.
5. WHEN o dono fecha a porta THEN o sistema SHALL persistir o estado fechado e impedir novas entradas de visitantes.
6. WHILE uma casa está aberta THEN o sistema SHALL permitir a entrada de visitantes mesmo se o dono estiver offline.
7. WHEN um ocupante sai ou desconecta THEN o sistema SHALL removê-lo da ocupação e encerrar sua pose temporária.
8. WHEN um jogador reconecta após desconexão dentro de uma casa THEN o sistema SHALL restaurá-lo fora, na entrada da casa dele.
9. The system SHALL keep interior movement and presence scoped to the matching house instance.

**Independent Test**: Com duas contas, entrar na casa aberta uma da outra, fechar a porta, tentar novamente e conferir isolamento de movimento.

### P1: Decorar e interagir em casa ⭐ MVP

**User Story**: Como dono, quero organizar os móveis iniciais; como ocupante, quero usar mesa, sofá, cama e rádio.

**Why P1**: Decoração e interações tornam a casa um espaço pessoal, não só uma tela de transição.

**Acceptance Criteria**:

1. WHEN o dono arrasta um móvel para uma posição válida THEN o sistema SHALL salvar a posição e atualizá-la para todos os ocupantes.
2. IF um visitante tenta mover móveis THEN o sistema SHALL rejeitar a alteração e manter a posição anterior.
3. IF uma posição de móvel está fora da planta, sobre parede ou sobre outro móvel THEN o sistema SHALL rejeitar a alteração e manter a posição anterior.
4. WHEN um ocupante interage com a mesa de trabalho THEN o sistema SHALL mostrar uma pose de trabalho enquanto ele permanecer junto à mesa.
5. WHEN um ocupante interage com sofá ou cama THEN o sistema SHALL mostrar uma pose de descanso sem alterar moedas ou progressão.
6. WHEN um ocupante ativa o rádio e a reprodução da casa está ociosa THEN o sistema SHALL iniciar uma vinheta original sem loop para todos os ocupantes daquela casa.
7. IF a vinheta já está tocando THEN o sistema SHALL ignorar novos acionamentos até o fim da reprodução atual.
8. IF o navegador não permite a reprodução de áudio THEN o sistema SHALL manter as demais interações funcionando.

**Independent Test**: Em duas sessões na mesma casa, editar móveis como dono e tentar como visitante; usar mesa, cama, sofá e rádio em ambas.

## Edge Cases

- IF um jogador ainda não escolheu região THEN o sistema SHALL adiar a criação da casa até uma região residencial existir.
- IF duas inicializações tentam criar a mesma casa ao mesmo tempo THEN o sistema SHALL retornar uma única casa persistida.
- IF o cliente envia tipo de móvel, posição ou estação desconhecidos THEN o sistema SHALL rejeitar a ação sem alterar estado.
- IF o ocupante está fora da instância ou distante do móvel THEN o sistema SHALL rejeitar a interação.
- WHEN o dono offline volta a ficar online THEN o sistema SHALL retornar ao mapa externo na entrada da própria casa.

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| HOME-01 | P1: Ter e visitar uma casa | In Tasks | Implementing |
| HOME-02 | P1: Ter e visitar uma casa | In Tasks | Implementing |
| HOME-03 | P1: Ter e visitar uma casa | In Tasks | Implementing |
| HOME-04 | P1: Ter e visitar uma casa | In Tasks | Implementing |
| HOME-05 | P1: Ter e visitar uma casa | In Tasks | Implementing |
| HOME-06 | P1: Ter e visitar uma casa | In Tasks | Implementing |
| HOME-07 | P1: Ter e visitar uma casa | In Tasks | Implementing |
| HOME-08 | P1: Ter e visitar uma casa | In Tasks | Implementing |
| HOME-09 | P1: Ter e visitar uma casa | In Tasks | Implementing |
| HOME-10 | P1: Decorar e interagir em casa | In Tasks | Implementing |
| HOME-11 | P1: Decorar e interagir em casa | In Tasks | Implementing |
| HOME-12 | P1: Decorar e interagir em casa | In Tasks | Implementing |
| HOME-13 | P1: Decorar e interagir em casa | In Tasks | Implementing |
| HOME-14 | P1: Decorar e interagir em casa | In Tasks | Implementing |
| HOME-15 | P1: Decorar e interagir em casa | In Tasks | Implementing |
| HOME-16 | P1: Decorar e interagir em casa | In Tasks | Implementing |
| HOME-17 | P1: Decorar e interagir em casa | In Tasks | Implementing |

**Coverage**: 17 total, 17 mapped to tasks, 0 unmapped.

## Success Criteria

- [ ] Jogadores novos e existentes com região recebem uma casa idempotente.
- [ ] Dois clientes compartilham a mesma casa e não recebem movimento de casas diferentes.
- [ ] Estado de porta e móveis sobrevive à reinicialização do processo via repositório persistente.
- [ ] Build, testes do servidor e teste visual no navegador passam.
