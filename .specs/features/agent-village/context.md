# Vila dos Agentes Context

**Gathered:** 2026-10-04
**Spec:** `.specs/features/agent-village/spec.md`
**Status:** Ready for design

## Feature Boundary

Adaptar o ensaio do chat “Criar mundo 3D para agentes” para um novo jogo independente da GameGameGame e preparar Dokploy. O usuário autorizou implementar e escolheu GPT-6.1 SOL Extra Alto para a implementação e GPT-5.6 Luna MAX para a etapa Dokploy.

## Implementation Decisions

- Nome e domínios confirmados: Vila dos Agentes, agents.gamegamegame.site, hml-agents.gamegamegame.site.
- Jardim acolhedor/isométrico, escritório acessível, mesa de tamanho escolhido e boneco por amigo.
- Um robô por chat; vários simultâneos do mesmo provedor.
- Compartilhamento none/title/description aplicado no servidor. Default none.
- Dono pode offline enquanto robôs continuam. Demo Renatin/Julin explicitamente fictícia.
- Não monitorar automaticamente todas as conversas; MCP sozinho não fornece essa observação.
- Preservar o ensaio original e mudanças locais alheias.

### Agent's Discretion

Escolhas rotineiras de arquitetura, implementação e ferramentas estão autorizadas. Persistência, convite, limites e ordem foram registrados como assumptions na spec. Não há aprovação remota implícita nesta etapa.

## Specific References

Ensaio read-only em `D:/Users/Usuario/Documents/Codex/2026-10-04/teria-como-a-gente-criar-tipo`; referência visual `eventos-na-vila.html` do chat original. Reaproveitar adaptadores e identidade visual, com crédito de origem no README.

## Deferred Ideas

Coletores instaláveis e integrações OAuth reais; múltiplas vilas; PostgreSQL para múltiplas réplicas.
