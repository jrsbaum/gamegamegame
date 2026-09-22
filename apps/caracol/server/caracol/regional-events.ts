import type { CaracolRegionalEventDefinition } from '../../shared/caracol';

/**
 * Estado de um estado (UF) no motor de clima regional. Espelha
 * `CaracolRegionalEventRecord` do store, sem o campo `uf` (que é a chave do
 * `Map`). Função pura: nada aqui lê relógio ou banco, tudo entra por parâmetro.
 */
export interface RegionalEventState {
  activeEventId: string | null;
  activatedAt: number | null;
  expiresAt: number | null;
  lastActivatedAt: number | null;
}

export interface RegionalEventChange {
  uf: string;
  event: CaracolRegionalEventDefinition;
}

export interface RegionalEventsCommitPlan {
  /** Estado de todo estado após a avaliação; ufs sem mudança repetem o valor de entrada. */
  nextByUf: Map<string, RegionalEventState>;
  activations: RegionalEventChange[];
  deactivations: RegionalEventChange[];
}

/** Teto de estados com evento ativo ao mesmo tempo (spec: 4 dos 27). */
export const REGIONAL_EVENTS_MAX_ACTIVE = 4;

/**
 * Fração da janela de "chance por hora" coberta por uma avaliação. O motor é
 * avaliado a cada 30 minutos (REGCLIM-01), então cada avaliação sorteia meia
 * hora da chance horária do catálogo.
 */
const EVALUATION_FRACTION_OF_HOUR = 0.5;

/** As 27 UFs (26 estados + DF). Fonte única também usada pelo manager para inicializar `regionalEventsByUf`. */
export const REGIONAL_UF_CODES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

function emptyState(): RegionalEventState {
  return { activeEventId: null, activatedAt: null, expiresAt: null, lastActivatedAt: null };
}

function monthOf(now: number): number {
  return new Date(now).getUTCMonth() + 1;
}

function definitionById(catalog: readonly CaracolRegionalEventDefinition[], id: string): CaracolRegionalEventDefinition | undefined {
  return catalog.find((event) => event.id === id);
}

function activeDefinitionFor(
  catalog: readonly CaracolRegionalEventDefinition[],
  uf: string | null,
  activeByUf: ReadonlyMap<string, RegionalEventState>,
): CaracolRegionalEventDefinition | null {
  if (!uf) return null;
  const state = activeByUf.get(uf);
  if (!state?.activeEventId) return null;
  return definitionById(catalog, state.activeEventId) ?? null;
}

function isSeasonallyEligible(event: CaracolRegionalEventDefinition, now: number): boolean {
  return event.mesesElegiveis.includes(monthOf(now));
}

function shouldExpire(event: CaracolRegionalEventDefinition, state: RegionalEventState, now: number): boolean {
  if (event.perfil === 'sazonal') return !isSeasonallyEligible(event, now);
  return state.expiresAt === null || now >= state.expiresAt;
}

/**
 * Primeira entrada elegível do estado nesta avaliação, na ordem do catálogo:
 * sazonal ativa deterministicamente quando o mês bate; raro sorteia dentro da
 * janela. Cobre o edge case de duas entradas raras sobrepostas (a primeira
 * que sortear ativa, nunca as duas).
 */
function eligibleCandidate(
  entries: CaracolRegionalEventDefinition[],
  now: number,
  random: () => number,
): CaracolRegionalEventDefinition | null {
  for (const event of entries) {
    if (event.perfil === 'sazonal') {
      if (isSeasonallyEligible(event, now)) return event;
      continue;
    }
    if (!isSeasonallyEligible(event, now)) continue;
    const chance = (event.chancePorHoraNaJanela ?? 0) * EVALUATION_FRACTION_OF_HOUR;
    if (random() < chance) return event;
  }
  return null;
}

function weightedPickWithoutReplacement<T>(items: Array<{ item: T; weight: number }>, count: number, random: () => number): T[] {
  const pool = items.slice();
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = random() * total;
    let index = 0;
    for (; index < pool.length - 1; index += 1) {
      roll -= pool[index]!.weight;
      if (roll <= 0) break;
    }
    picked.push(pool[index]!.item);
    pool.splice(index, 1);
  }
  return picked;
}

/**
 * Avalia todos os estados presentes em `activeByUf` e devolve o que muda.
 * Não empilha nem interrompe (REGCLIM-03): um estado com evento ativo cuja
 * duração não expirou é ignorado nesta avaliação. Quem acabou de expirar só
 * fica elegível de novo na próxima chamada (REGCLIM-04). Nunca ativa mais de
 * `REGIONAL_EVENTS_MAX_ACTIVE` ao mesmo tempo (REGCLIM-02).
 */
export function evaluate(
  catalog: readonly CaracolRegionalEventDefinition[],
  now: number,
  activeByUf: ReadonlyMap<string, RegionalEventState>,
  random: () => number,
): RegionalEventsCommitPlan {
  const nextByUf = new Map<string, RegionalEventState>();
  const activations: RegionalEventChange[] = [];
  const deactivations: RegionalEventChange[] = [];
  const entriesByUf = new Map<string, CaracolRegionalEventDefinition[]>();
  for (const event of catalog) {
    const list = entriesByUf.get(event.uf) ?? [];
    list.push(event);
    entriesByUf.set(event.uf, list);
  }

  let activeCount = 0;
  const candidateUfs: string[] = [];
  for (const [uf, state] of activeByUf) {
    if (state.activeEventId) {
      const event = definitionById(catalog, state.activeEventId);
      if (event && !shouldExpire(event, state, now)) {
        nextByUf.set(uf, state);
        activeCount += 1;
        continue;
      }
      // Expira agora (ou o item saiu do catálogo): some do ativo, mas só
      // fica elegível de novo na próxima avaliação (não reativa no mesmo ciclo).
      const deactivated: RegionalEventState = { activeEventId: null, activatedAt: null, expiresAt: null, lastActivatedAt: now };
      nextByUf.set(uf, deactivated);
      if (event) deactivations.push({ uf, event });
      continue;
    }
    nextByUf.set(uf, state);
    candidateUfs.push(uf);
  }

  const candidates = candidateUfs
    .map((uf) => ({ uf, event: eligibleCandidate(entriesByUf.get(uf) ?? [], now, random) }))
    .filter((entry): entry is { uf: string; event: CaracolRegionalEventDefinition } => entry.event !== null);

  const remainingSlots = Math.max(0, REGIONAL_EVENTS_MAX_ACTIVE - activeCount);
  const selected = candidates.length <= remainingSlots
    ? candidates
    : weightedPickWithoutReplacement(
      candidates.map((candidate) => ({
        item: candidate,
        weight: Math.max(1, now - (nextByUf.get(candidate.uf)?.lastActivatedAt ?? 0)),
      })),
      remainingSlots,
      random,
    );

  for (const { uf, event } of selected) {
    const activated: RegionalEventState = {
      activeEventId: event.id,
      activatedAt: now,
      expiresAt: event.perfil === 'sazonal' ? null : now + (event.duracaoMs ?? 0),
      lastActivatedAt: now,
    };
    nextByUf.set(uf, activated);
    activations.push({ uf, event });
  }

  return { nextByUf, activations, deactivations };
}

/** Fator de preço aplicado a uma conta pelo evento ativo no seu estado; 1 sem evento ou sem efeito `precoConta`. */
export function priceFactorFor(
  catalog: readonly CaracolRegionalEventDefinition[],
  uf: string | null,
  activeByUf: ReadonlyMap<string, RegionalEventState>,
): number {
  const event = activeDefinitionFor(catalog, uf, activeByUf);
  return event?.jogador?.tipo === 'precoConta' ? event.jogador.multiplicador : 1;
}

/** Produto dos multiplicadores `velocidadeMundo` de todo estado ativo; 1 sem nenhum. */
export function worldSpeedFactor(
  catalog: readonly CaracolRegionalEventDefinition[],
  activeByUf: ReadonlyMap<string, RegionalEventState>,
): number {
  let factor = 1;
  for (const uf of activeByUf.keys()) {
    const event = activeDefinitionFor(catalog, uf, activeByUf);
    if (event?.caracol?.tipo === 'velocidadeMundo') factor *= event.caracol.multiplicador;
  }
  return factor;
}

/** Multiplicador de perseguição contra o alvo quando o estado dele tem `velocidadeContraAlvoNoEstado` ativo; 1 caso contrário. */
export function chaseSpeedFactorAgainst(
  catalog: readonly CaracolRegionalEventDefinition[],
  targetUf: string | null,
  activeByUf: ReadonlyMap<string, RegionalEventState>,
): number {
  const event = activeDefinitionFor(catalog, targetUf, activeByUf);
  return event?.caracol?.tipo === 'velocidadeContraAlvoNoEstado' ? event.caracol.multiplicador : 1;
}

export interface RegionalPlayerViewOverrides {
  hidden: boolean;
  etaBucket: { minutos: number; km: number } | null;
}

/** `hidden`/arredondamento de ETA que o evento ativo no estado da conta impõe à visão dela. */
export function playerViewOverridesFor(
  catalog: readonly CaracolRegionalEventDefinition[],
  uf: string | null,
  activeByUf: ReadonlyMap<string, RegionalEventState>,
): RegionalPlayerViewOverrides {
  const event = activeDefinitionFor(catalog, uf, activeByUf);
  return {
    hidden: event?.jogador?.tipo === 'escondeJogador',
    etaBucket: event?.jogador?.tipo === 'etaBorrado' ? { minutos: event.jogador.passoMinutos, km: event.jogador.passoKm } : null,
  };
}

/**
 * Recusa subir o processo se o catálogo estiver malformado (mesmo padrão de
 * `wordlist.ts`/`drawing-wordlist.ts`). Chamado no boot (REGCLIM-08).
 */
export function validateCatalog(catalog: readonly CaracolRegionalEventDefinition[]): void {
  const seenIds = new Set<string>();
  for (const event of catalog) {
    const label = `evento '${event.id || '(sem id)'}'`;
    if (!event.id || seenIds.has(event.id)) {
      throw new Error(`Catálogo de eventos regionais inválido: ${label} tem id ausente ou duplicado.`);
    }
    seenIds.add(event.id);
    if (!REGIONAL_UF_CODES.includes(event.uf as typeof REGIONAL_UF_CODES[number])) {
      throw new Error(`Catálogo de eventos regionais inválido: ${label} tem uf inválida ('${event.uf}').`);
    }
    if (!Array.isArray(event.mesesElegiveis) || event.mesesElegiveis.length === 0 || event.mesesElegiveis.some((month) => !Number.isInteger(month) || month < 1 || month > 12)) {
      throw new Error(`Catálogo de eventos regionais inválido: ${label} tem mesesElegiveis malformado.`);
    }
    if (!event.jogador && !event.caracol) {
      throw new Error(`Catálogo de eventos regionais inválido: ${label} não define efeito de jogador nem de caracol.`);
    }
    if (event.caracol && event.caracol.tipo !== 'velocidadeMundo' && event.caracol.tipo !== 'velocidadeContraAlvoNoEstado') {
      throw new Error(`Catálogo de eventos regionais inválido: ${label} tem efeito de caracol inválido ('${event.caracol.tipo}').`);
    }
    if (event.perfil === 'raro') {
      if (typeof event.chancePorHoraNaJanela !== 'number' || event.chancePorHoraNaJanela <= 0) {
        throw new Error(`Catálogo de eventos regionais inválido: ${label} é raro e precisa de chancePorHoraNaJanela positiva.`);
      }
      if (typeof event.duracaoMs !== 'number' || event.duracaoMs <= 0) {
        throw new Error(`Catálogo de eventos regionais inválido: ${label} é raro e precisa de duracaoMs positiva.`);
      }
    } else if (event.duracaoMs !== null) {
      throw new Error(`Catálogo de eventos regionais inválido: ${label} é sazonal e não pode ter duracaoMs (deve ser null).`);
    }
  }
}

export function emptyRegionalEventState(): RegionalEventState {
  return emptyState();
}
