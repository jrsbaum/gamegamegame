import { describe, expect, it } from 'vitest';
import { MemoryCaracolStore, type CaracolRegionalEventRecord } from '../server/caracol/store';

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
