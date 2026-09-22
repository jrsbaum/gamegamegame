# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-009 - Assert that a frozen/snapshot value is the one consumed by the calculation, not merely that it was stored
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `server` · harmful: 0
- features: placar-da-sessao
- evidence: validation.md M4 - server/game.ts:245 (server)
- last seen: 2026-08-09T00:58:25Z

### L-010 - Test the acceptance criterion under its own stated precondition, not a simpler state that happens to share the expected value
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: placar-da-sessao
- evidence: SCORE-07 - tests/game.integration.test.ts:826 (tests)
- last seen: 2026-08-09T00:58:25Z

### L-011 - When an Assumption fixes a field representation, restate that exact value in the acceptance criterion so AC and Assumption cannot disagree
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: placar-da-sessao
- evidence: SCORE-03 - .specs/features/placar-da-sessao/spec.md:38,57 (spec)
- last seen: 2026-08-09T00:58:25Z

### L-012 - Uma asserção estrutural que ancora um call site por regex precisa de quantificador limitado: com [\s\S]*? ela continua passando se a chamada migrar para um método auxiliar declarado depois da âncora, que é exatamente a regressão que ela deveria pegar.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: encerrar-rodada-travada
- evidence: verifier round 1, tests/game.integration.test.ts:441 (tests)
- last seen: 2026-08-09T01:51:44Z

### L-013 - Um teste cujo efeito é apagado logo depois por um reset mais amplo não prova nada: ancore a asserção numa fase em que o reset não roda, ou prove que o mutante morre antes de dar a cobertura por boa.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: powerup-de-dica
- evidence: verifier rodada 1 (tests)
- last seen: 2026-08-09T02:56:16Z

### L-014 - Uma AC cujo efeito o desenho torna inobservável é AC vazia: se nenhum consumidor lê o valor, a implementação vira código morto e a evidência acaba emprestada de outra AC.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: powerup-de-dica
- evidence: verifier rodada 1 (tests)
- last seen: 2026-08-09T02:56:16Z

### L-015 - Ao persistir uma ação de revogação (logout, invalidação de token), escrever teste que revoga e depois tenta reautenticar/reusar — não só o caminho de sucesso da persistência.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `server/caracol` · harmful: 0
- features: caracol-sessao-persistente
- evidence: CARSESS-03 (server/caracol)
- last seen: 2026-09-21T16:46:33Z

### L-016 - Quando uma regra 'não empilha/não interrompe' cobre mais de um perfil de estado (ex: sazonal e raro/com duração), teste cada perfil separadamente — um teste só com o perfil sazonal não exercita o ramo de expiração por timestamp usado pelo raro.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `server/caracol/regional-events.ts` · harmful: 0
- features: caracol-eventos-regionais
- evidence: server/caracol/regional-events.ts:70-73 (server/caracol/regional-events.ts)
- last seen: 2026-09-21T18:39:38Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
