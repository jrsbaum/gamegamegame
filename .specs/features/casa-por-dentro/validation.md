# Validação: Casa por dentro

**Data:** 2026-09-24
**Branch:** `codex/lafarmer-casa-por-dentro`
**Base:** `staging` (`6730af0`)
**Resultado:** PASS para os critérios de aceitação exercitados abaixo.

## Build e testes

- `npm run build` — passou no Node 22.13.0.
- `npm test` — passou: servidor 25/25, conteúdo 6/6, layout 1/1 (32 testes, 0 falhas).
- O Vite avisou que o bundle principal minificado tem aproximadamente 1,77 MB; o build concluiu normalmente.
- A revisão independente anterior matou os 3 mutantes de acesso à porta e edição de móveis.

## PostgreSQL descartável e WebSockets

Validação em PostgreSQL 17 num container local, sem volume e sem conexão com HML/produção:

- Cadastro e perfil provisionaram uma única casa; consulta confirmou uma linha para o dono.
- Móvel do rádio e porta fechada permaneceram depois de reiniciar o servidor. Ao reconectar, o personagem voltou para fora em `(30,47)`; o dono entrou mesmo com a porta fechada.
- Em uma sessão com três clientes, dono e visita entraram com a porta aberta. A visita não pôde mover móveis; fechar a porta manteve a visita atual dentro e bloqueou a nova entrada.
- A visita tocou o rádio: os dois ocupantes receberam o mesmo `playId`; o terceiro cliente não recebeu o evento. A segunda ativação durante a janela de 3 segundos foi ignorada.
- Uma mudança feita pelo dono chegou à visita dentro da casa.

## Navegador Edge

- O onboarding real criou uma conta e a cena da casa exibiu sala/cozinha, escritório, quarto, banheiro e os 13 móveis iniciais.
- O rádio gerou um `AudioContext` em estado `running` e reproduziu o evento de 3 segundos sem erro no console.
- Em viewport desktop, movimento por teclado produziu acknowledgements do servidor. Em viewport móvel, o joystick ficou visível e movimento por toque também produziu acknowledgements.
- Para focar a cena interna, o smoke enviou `home.enter` pela conexão autenticada depois de posicionar a conta de teste na porta; a entrada pela porta clicada e o arraste de móveis com mouse não foram exercitados visualmente.

## Limites restantes

- O fallback com áudio explicitamente bloqueado pelo navegador não foi simulado. O código captura falhas de `AudioContext`; é uma verificação manual complementar.
- Não houve validação em HML ou produção, nem deploy. O PostgreSQL foi descartável e local.

## Conclusão

Os fluxos de persistência real, reinício, entrada/autorização, isolamento multiplayer, rádio, renderização e controles por teclado/toque passaram. Os limites acima são verificações manuais complementares, não falhas conhecidas de implementação.
