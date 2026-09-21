import type { CaracolRegionalEventDefinition } from './caracol';

/**
 * Catálogo dos eventos regionais por estado. Vazio nesta fase (motor
 * genérico, P1): o catálogo completo (~50 eventos, P2) entra num lote
 * seguinte. Fonte: `plano/eventos-clima-proposta-completa.md`.
 */
export const CARACOL_REGIONAL_EVENTS_CATALOG: CaracolRegionalEventDefinition[] = [];

export function regionalEventsByUf(uf: string): CaracolRegionalEventDefinition[] {
  return CARACOL_REGIONAL_EVENTS_CATALOG.filter((event) => event.uf === uf);
}
