# Casa por dentro Context

**Gathered:** 2026-09-23
**Spec:** `.specs/features/casa-por-dentro/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Casa inicial compartilhável, com planta fixa, decoração inicial reposicionável, porta persistente, poses de trabalho/descanso e rádio com vinheta. Não inclui loja, expansão, armazenamento ou efeitos econômicos.

## Implementation Decisions

### Visual e planta

- Manter o estilo 2D do LaFarmer, com mapa interno visto de cima e os cômodos aparentes.
- Planta de um piso com sala/cozinha integradas, quarto, banheiro e escritório.
- Casa começa mobiliada; o dono pode mover móveis, visitantes só interagem.

### Acesso e persistência

- Casa gratuita criada automaticamente para contas com região, inclusive contas existentes, sem duplicar registros.
- Porta começa aberta, permanece acessível com dono offline e pode ser fechada pelo dono.
- Fechar a porta impede novas visitas; ocupantes atuais podem sair normalmente.
- Ocupação e poses são temporárias; porta e posições dos móveis são persistidas.
- Após desconectar, o jogador volta à área externa na porta da própria casa.

### Interações e áudio

- Mesa exibe pose de trabalho; sofá e cama exibem pose de descanso, sem bônus.
- Qualquer ocupante pode acionar o rádio; quem está na mesma casa ouve uma vinheta original, curta e sem loop.
- Não iniciar outra reprodução enquanto a atual está ativa; áudio bloqueado não interrompe o jogo.
- Interações via E e pointer events (mouse/toque); o rádio também recebe clique direto.

### Agent's Discretion

- Grade e coordenadas exatas da planta e dos móveis, preservando a divisão aprovada dos cômodos.
- Mensagens curtas de erro e apresentação visual de poses.
- Geração local da vinheta, sem material de terceiros.

### Declined / Undiscussed Gray Areas → Assumptions

- A casa só pode ser criada após uma região ser escolhida, pois contas recém-registradas ainda não têm região.
- Móveis não podem ser sobrepostos nem colocados em paredes/fora da planta.
- Visitantes não controlam porta nem decoração.
- O navegador pode silenciar a reprodução até ocorrer interação local; isso não bloqueia a ação no jogo.

## Specific References

- A imagem anexada serviu como referência de casa aberta/cômodos visíveis; a direção escolhida foi 2D do próprio jogo.
- Stardew Valley para a conexão casa/fazenda; Unpacking para leitura dos objetos domésticos; Animal Crossing para decoração; Duel Links para uma futura mesa de atividade social.

## Deferred Ideas

- Loja e expansão de móveis/cômodos.
- Mesa de duelo de cartas ou outras atividades sociais com regras próprias.
