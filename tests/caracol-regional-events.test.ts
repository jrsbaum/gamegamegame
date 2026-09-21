import { describe, expect, it } from 'vitest';
import { MemoryCaracolStore, type CaracolRegionalEventRecord } from '../server/caracol/store';
import type { CaracolRegionalEventDefinition } from '../shared/caracol';
import { CARACOL_REGIONAL_EVENTS_CATALOG } from '../shared/caracol-regional-events';
import {
  chaseSpeedFactorAgainst,
  evaluate,
  playerViewOverridesFor,
  priceFactorFor,
  REGIONAL_EVENTS_MAX_ACTIVE,
  validateCatalog,
  worldSpeedFactor,
  type RegionalEventState,
} from '../server/caracol/regional-events';

/** Conta quantas entradas do catálogo pertencem a cada UF de `ufs`. */
function countByUf(ufs: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const uf of ufs) {
    counts[uf] = CARACOL_REGIONAL_EVENTS_CATALOG.filter((event) => event.uf === uf).length;
  }
  return counts;
}

/** Nenhum item marcado ⚠️ nos documentos de referência pode aparecer no catálogo. */
function expectNoFlaggedItems(pattern: RegExp) {
  const hit = CARACOL_REGIONAL_EVENTS_CATALOG.find(
    (event) => pattern.test(event.id) || pattern.test(event.nome),
  );
  expect(hit).toBeUndefined();
}

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const NOW = Date.UTC(2026, 5, 15); // junho de 2026 -> mês 6

function emptyState(): RegionalEventState {
  return { activeEventId: null, activatedAt: null, expiresAt: null, lastActivatedAt: null };
}

function sazonalEvento(uf: string, id = `${uf}-sazonal`): CaracolRegionalEventDefinition {
  return {
    id,
    uf,
    nome: 'Evento de teste sazonal',
    perfil: 'sazonal',
    mesesElegiveis: ALL_MONTHS,
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 2 },
  };
}

function raroEvento(uf: string, overrides: Partial<CaracolRegionalEventDefinition> = {}): CaracolRegionalEventDefinition {
  return {
    id: `${uf}-raro`,
    uf,
    nome: 'Evento de teste raro',
    perfil: 'raro',
    mesesElegiveis: ALL_MONTHS,
    chancePorHoraNaJanela: 1,
    duracaoMs: 60 * 60_000,
    jogador: { tipo: 'saldoInstantaneo', delta: 10 },
    ...overrides,
  };
}

describe('motor genérico de eventos regionais', () => {
  it('evaluate() nunca ativa mais de REGIONAL_EVENTS_MAX_ACTIVE estados, mesmo com todos elegíveis', () => {
    const ufs = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MT'];
    const catalog = ufs.map((uf) => sazonalEvento(uf));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const activeByUf = new Map(ufs.map((uf) => [uf, emptyState()]));
      const plan = evaluate(catalog, NOW, activeByUf, Math.random);
      const activeCount = Array.from(plan.nextByUf.values()).filter((state) => state.activeEventId !== null).length;
      expect(activeCount).toBeLessThanOrEqual(REGIONAL_EVENTS_MAX_ACTIVE);
      expect(plan.activations.length).toBeLessThanOrEqual(REGIONAL_EVENTS_MAX_ACTIVE);
    }
  });

  it('não interrompe nem empilha um evento cuja duração ainda não expirou', () => {
    const active = sazonalEvento('CE', 'ce-atual');
    const outroElegivel = raroEvento('CE', { id: 'ce-outro', chancePorHoraNaJanela: 1_000_000 });
    const catalog = [active, outroElegivel];
    const activeByUf = new Map<string, RegionalEventState>([
      ['CE', { activeEventId: 'ce-atual', activatedAt: NOW - 1_000, expiresAt: null, lastActivatedAt: NOW - 1_000 }],
    ]);
    const plan = evaluate(catalog, NOW, activeByUf, () => 0);
    expect(plan.nextByUf.get('CE')?.activeEventId).toBe('ce-atual');
    expect(plan.activations).toHaveLength(0);
    expect(plan.deactivations).toHaveLength(0);
  });

  it('expira um evento raro assim que sua duração passa e o estado some da lista de ativos', () => {
    const event = raroEvento('SP');
    const activeByUf = new Map<string, RegionalEventState>([
      ['SP', { activeEventId: event.id, activatedAt: NOW - 120_000, expiresAt: NOW - 1_000, lastActivatedAt: NOW - 120_000 }],
    ]);
    const plan = evaluate([event], NOW, activeByUf, () => 1); // random alto: não reativa no mesmo ciclo
    expect(plan.nextByUf.get('SP')?.activeEventId).toBeNull();
    expect(plan.deactivations).toEqual([{ uf: 'SP', event }]);
    expect(plan.activations).toHaveLength(0);
  });

  it('expira um evento sazonal quando o mês sai da janela elegível', () => {
    const event: CaracolRegionalEventDefinition = { ...sazonalEvento('BA'), mesesElegiveis: [12, 1, 2] };
    const activeByUf = new Map<string, RegionalEventState>([
      ['BA', { activeEventId: event.id, activatedAt: NOW - 1_000, expiresAt: null, lastActivatedAt: NOW - 1_000 }],
    ]);
    const plan = evaluate([event], NOW, activeByUf, () => 1);
    expect(plan.nextByUf.get('BA')?.activeEventId).toBeNull();
    expect(plan.deactivations).toEqual([{ uf: 'BA', event }]);
  });

  it('estado sem nenhum evento elegível no catálogo simplesmente não ativa nada', () => {
    const event: CaracolRegionalEventDefinition = { ...sazonalEvento('RJ'), mesesElegiveis: [1] };
    const activeByUf = new Map<string, RegionalEventState>([['RJ', emptyState()]]);
    const plan = evaluate([event], NOW, activeByUf, () => 0);
    expect(plan.nextByUf.get('RJ')?.activeEventId).toBeNull();
    expect(plan.activations).toHaveLength(0);
  });

  it('escolhe a primeira entrada rara elegível do catálogo quando duas se sobrepõem no mesmo estado', () => {
    const primeira = raroEvento('PE', { id: 'pe-primeiro' });
    const segunda = raroEvento('PE', { id: 'pe-segundo' });
    const activeByUf = new Map<string, RegionalEventState>([['PE', emptyState()]]);
    const plan = evaluate([primeira, segunda], NOW, activeByUf, () => 0); // random baixo: sempre "sorteia"
    expect(plan.activations).toHaveLength(1);
    expect(plan.activations[0]?.event.id).toBe('pe-primeiro');
  });

  it('ativa um evento com efeito "ambos" atomicamente: preço e velocidade do caracol respondem juntos', () => {
    const evento: CaracolRegionalEventDefinition = {
      id: 'ms-cheia',
      uf: 'MS',
      nome: 'Cheia do Pantanal',
      perfil: 'sazonal',
      mesesElegiveis: ALL_MONTHS,
      duracaoMs: null,
      jogador: { tipo: 'precoConta', multiplicador: 0.5 },
      caracol: { tipo: 'velocidadeMundo', multiplicador: 0.8 },
    };
    const activeByUf = new Map<string, RegionalEventState>([
      ['MS', { activeEventId: 'ms-cheia', activatedAt: NOW, expiresAt: null, lastActivatedAt: NOW }],
    ]);
    expect(priceFactorFor([evento], 'MS', activeByUf)).toBe(0.5);
    expect(worldSpeedFactor([evento], activeByUf)).toBe(0.8);

    const desativado = new Map<string, RegionalEventState>([['MS', emptyState()]]);
    expect(priceFactorFor([evento], 'MS', desativado)).toBe(1);
    expect(worldSpeedFactor([evento], desativado)).toBe(1);
  });

  it('validateCatalog lança um erro descritivo para cada tipo de catálogo malformado', () => {
    const base = raroEvento('SC');
    expect(() => validateCatalog([{ ...base, uf: 'XX' }])).toThrow(/uf inválida/);
    expect(() => validateCatalog([{ ...base, chancePorHoraNaJanela: undefined }])).toThrow(/chancePorHoraNaJanela/);
    expect(() => validateCatalog([{ ...base, jogador: undefined, caracol: undefined }])).toThrow(/não define efeito/);
    expect(() => validateCatalog([{ ...base, duracaoMs: null as unknown as number }])).toThrow(/duracaoMs/);
  });
});

describe('leitura de efeitos regionais (fatores e visão)', () => {
  const chaseEvento: CaracolRegionalEventDefinition = {
    id: 'mg-zcas',
    uf: 'MG',
    nome: 'ZCAS',
    perfil: 'raro',
    mesesElegiveis: ALL_MONTHS,
    chancePorHoraNaJanela: 1,
    duracaoMs: 60 * 60_000,
    caracol: { tipo: 'velocidadeContraAlvoNoEstado', multiplicador: 1.3 },
  };
  const ativoEmMg = new Map<string, RegionalEventState>([
    ['MG', { activeEventId: 'mg-zcas', activatedAt: NOW, expiresAt: NOW + 60_000, lastActivatedAt: NOW }],
  ]);

  it('chaseSpeedFactorAgainst só aplica o multiplicador quando o alvo mora no estado com o evento ativo', () => {
    expect(chaseSpeedFactorAgainst([chaseEvento], 'MG', ativoEmMg)).toBe(1.3);
    expect(chaseSpeedFactorAgainst([chaseEvento], 'SP', ativoEmMg)).toBe(1);
    expect(chaseSpeedFactorAgainst([chaseEvento], null, ativoEmMg)).toBe(1);
  });

  it('playerViewOverridesFor esconde o jogador quando escondeJogador está ativo', () => {
    const evento: CaracolRegionalEventDefinition = { ...sazonalEvento('AM'), jogador: { tipo: 'escondeJogador' } };
    const ativo = new Map<string, RegionalEventState>([['AM', { activeEventId: evento.id, activatedAt: NOW, expiresAt: null, lastActivatedAt: NOW }]]);
    expect(playerViewOverridesFor([evento], 'AM', ativo)).toEqual({ hidden: true, etaBucket: null });
  });

  it('playerViewOverridesFor arredonda o ETA quando etaBorrado está ativo', () => {
    const evento: CaracolRegionalEventDefinition = {
      ...sazonalEvento('CE'),
      jogador: { tipo: 'etaBorrado', passoMinutos: 30, passoKm: 50 },
    };
    const ativo = new Map<string, RegionalEventState>([['CE', { activeEventId: evento.id, activatedAt: NOW, expiresAt: null, lastActivatedAt: NOW }]]);
    expect(playerViewOverridesFor([evento], 'CE', ativo)).toEqual({ hidden: false, etaBucket: { minutos: 30, km: 50 } });
  });

  it('playerViewOverridesFor não altera nada sem evento ativo no estado', () => {
    expect(playerViewOverridesFor([chaseEvento], 'MG', new Map([['MG', emptyState()]]))).toEqual({ hidden: false, etaBucket: null });
  });
});

describe('store dos eventos regionais', () => {
  it('devolve snapshot com regionalEvents vazio antes de qualquer save', async () => {
    const store = new MemoryCaracolStore();
    const snapshot = await store.loadSnapshot();
    expect(snapshot.regionalEvents).toEqual([]);
  });

  it('faz round-trip de save/load de um evento regional ativo', async () => {
    const store = new MemoryCaracolStore();
    const record: CaracolRegionalEventRecord = {
      uf: 'CE',
      activeEventId: 'ce-seca',
      activatedAt: 1_000,
      expiresAt: 5_000,
      lastActivatedAt: 1_000,
    };
    await store.saveRegionalEvents([record]);
    const loaded = await store.loadRegionalEvents();
    expect(loaded).toEqual([record]);
    const snapshot = await store.loadSnapshot();
    expect(snapshot.regionalEvents).toEqual([record]);
  });

  it('faz round-trip de claim e confirma que hasRegionalClaim reflete o que foi gravado', async () => {
    const store = new MemoryCaracolStore();
    expect(await store.hasRegionalClaim('SC', 1_000, 'acc-1')).toBe(false);
    const recorded = await store.recordRegionalClaim({
      uf: 'SC',
      activatedAt: 1_000,
      accountId: 'acc-1',
      eventId: 'sc-oktoberfest',
      claimedAt: 1_500,
    });
    expect(recorded).toBe(true);
    expect(await store.hasRegionalClaim('SC', 1_000, 'acc-1')).toBe(true);
  });

  it('recusa claim duplicado para a mesma (uf, activatedAt, accountId) sem lançar', async () => {
    const store = new MemoryCaracolStore();
    const claim = { uf: 'SC', activatedAt: 1_000, accountId: 'acc-1', eventId: 'sc-oktoberfest', claimedAt: 1_500 };
    expect(await store.recordRegionalClaim(claim)).toBe(true);
    expect(await store.recordRegionalClaim({ ...claim, claimedAt: 2_000 })).toBe(false);
  });
});

describe('catálogo de eventos regionais — Região Norte (T8)', () => {
  it('valida sem lançar depois da região Norte adicionada', () => {
    expect(() => validateCatalog(CARACOL_REGIONAL_EVENTS_CATALOG)).not.toThrow();
  });

  it('contagem por estado da região Norte bate com o material de referência', () => {
    expect(countByUf(['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'])).toEqual({
      AC: 2,
      AM: 2,
      AP: 2,
      PA: 2,
      RO: 1,
      RR: 1,
      TO: 2,
    });
  });

  it('nenhuma entrada da região Norte referencia o Festival Indígena Anna Eseru (RR) marcado ⚠️', () => {
    expectNoFlaggedItems(/anna eseru|indígena/i);
  });
});

describe('catálogo de eventos regionais — Região Nordeste (T9)', () => {
  it('valida sem lançar depois da região Nordeste adicionada', () => {
    expect(() => validateCatalog(CARACOL_REGIONAL_EVENTS_CATALOG)).not.toThrow();
  });

  it('contagem por estado da região Nordeste bate com o material de referência', () => {
    expect(countByUf(['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'])).toEqual({
      AL: 2,
      BA: 2,
      CE: 2,
      MA: 2,
      PB: 2,
      PE: 2,
      PI: 2,
      RN: 2,
      SE: 2,
    });
  });

  it('nenhuma entrada da região Nordeste referencia quilombo/indígena marcados ⚠️ (AL, PE, CE)', () => {
    expectNoFlaggedItems(/quilombo|palmares|catucá|conceição das crioulas|indígena/i);
  });
});
