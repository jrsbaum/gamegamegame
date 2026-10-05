# Vila dos Agentes: tarefas no balão

## Problem Statement

O editor atual pede que o dono invente um título e uma descrição para cada robô. A vila já recebe os eventos da tarefa atual, então o compartilhamento deve acompanhar o trabalho real e aparecer perto do robô.

## Goals

- [x] Derivar um resumo curto da tarefa atual a partir do prompt do provedor.
- [x] Exibir estado, título ou estado+título no balão conforme a privacidade.
- [x] Exibir a descrição somente no caderninho quando o dono compartilhar título e descrição.
- [x] Remover os campos manuais de título e descrição do editor.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Capturar transcript ou resposta do agente | A vila precisa de um resumo da tarefa, não do conteúdo da conversa. |
| Alterar autenticação do Codex ou Claude | O pareamento existente continua responsável pelo login local. |
| Criar novos estados de trabalho | O balão reutiliza os estados que a vila já conhece. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Título derivado | Primeira linha não vazia, normalizada e limitada a 120 caracteres | Mantém o balão legível sem copiar a conversa inteira | agent discretion |
| Descrição derivada | Prompt normalizado limitado a 280 caracteres | Dá contexto ao caderninho sem guardar transcript | agent discretion |
| Evento sem prompt | Um envio de tarefa vazio limpa o resumo e mostra só o estado; um evento de inicialização preserva o último resumo | Hooks de início de sessão podem não conter uma tarefa | agent discretion |

**Open questions:** none.

## User Stories

**User Story**: Como morador, quero escolher o nível de compartilhamento e deixar que a vila mostre automaticamente a tarefa atual do meu robô.

**Independent Test**: Enviar uma tarefa com título em uma linha e descrição em várias linhas, consultar cada privacidade e conferir o balão, o caderninho e o editor.

## Acceptance Criteria

1. **BUBBLE-01**: WHEN um hook de envio de tarefa trouxer um prompt THEN o coletor SHALL enviar somente título e descrição normalizados, sem argumentos, respostas, caminhos ou credenciais.
2. **BUBBLE-02**: WHEN a tarefa for aceita THEN o servidor SHALL atualizar o resumo corrente do robô; eventos posteriores de ferramenta SHALL preservar esse resumo até uma nova tarefa.
3. **BUBBLE-03**: WHEN a projeção for `none` THEN o cliente SHALL mostrar somente o estado no balão; WHEN for `title` SHALL mostrar somente o título; WHEN for `description` SHALL mostrar estado e título abreviado no balão e a descrição no caderninho.
4. **BUBBLE-04**: O editor do dono SHALL permitir alterar nome e privacidade, mas SHALL remover os campos manuais de título e descrição.

## Edge Cases

- IF o prompt estiver vazio THEN nenhum texto de tarefa SHALL ser criado e o balão SHALL usar o estado.
- IF o título exceder 120 caracteres ou a descrição 280 THEN o coletor SHALL truncar antes do envio.
- IF o título ou descrição não estiverem na projeção pública THEN o cliente SHALL ocultar o conteúdo correspondente.

## Requirement Traceability

| Requirement ID | Evidence | Status |
| --- | --- | --- |
| BUBBLE-01 | `apps/agent-village/tests/connector.test.mjs` | Verified |
| BUBBLE-02 | `apps/agent-village/tests/events.test.mjs` | Verified |
| BUBBLE-03 | `apps/agent-village/tests/bubbles.test.mjs`, `apps/agent-village/web/main.ts`, `apps/agent-village/web/world.ts` | Verified |
| BUBBLE-04 | `apps/agent-village/web/main.ts` | Verified |
