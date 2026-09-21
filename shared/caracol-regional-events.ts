import type { CaracolRegionalEventDefinition } from './caracol';

const HORA_MS = 3_600_000;

/**
 * Catálogo dos eventos regionais por estado, traduzido de
 * `plano/eventos-clima-proposta-completa.md` (prosa aprovada) e
 * `plano/eventos-regionais-clima-brasil.md` (tabela por estado com
 * gatilho/duração). Populado região por região (T8-T12); nenhum item
 * marcado ⚠️ nos dois documentos entra aqui (festival indígena nomeado em
 * Roraima/Ceará, Quilombo de Palmares/Catucá/Conceição das Crioulas em
 * Alagoas/Pernambuco, moldura étnica de "cultura gaúcha"/imigração em
 * RS/SC).
 *
 * Convenções usadas para traduzir a prosa em dado:
 * - "sempre ativo"/"durante toda a estação" -> `perfil: 'sazonal'`,
 *   `duracaoMs: null` (dura enquanto o mês estiver em `mesesElegiveis`).
 * - "raro"/"chance de X% por hora" -> `perfil: 'raro'`,
 *   `chancePorHoraNaJanela: X` (fração, não percentual).
 * - "~1x/semana" sem % explícito -> `chancePorHoraNaJanela` calculado como
 *   1/(7*24) ≈ 0.006 (uma ocorrência esperada por semana, distribuída pela
 *   janela elegível). "~1x/2 semanas" -> metade disso, ≈ 0.003.
 * - Faixa de duração (ex: "2-4h", "3-6h") -> valor único no meio da faixa,
 *   documentado inline quando a escolha não é óbvia.
 * - "Redirect"/"aceleração"/"loja" ×N no jogador -> `precoConta` (o mesmo
 *   fator já multiplica `redirectCost`/`speedCost`, ver `price()`).
 * - "Acelera/desacelera o caracol inteiro" (sem mencionar o alvo) ->
 *   `velocidadeMundo`; "contra o alvo"/"quando o alvo está lá" ->
 *   `velocidadeContraAlvoNoEstado`.
 */
export const CARACOL_REGIONAL_EVENTS_CATALOG: CaracolRegionalEventDefinition[] = [
  // ---- Região Norte (T8) ----
  {
    id: 'ac-friagem',
    uf: 'AC',
    nome: 'Friagem',
    perfil: 'raro',
    mesesElegiveis: [6, 7, 8],
    chancePorHoraNaJanela: 0.3,
    duracaoMs: 2 * HORA_MS,
    caracol: { tipo: 'velocidadeMundo', multiplicador: 0.7 },
  },
  {
    id: 'ac-fumaca-br364',
    uf: 'AC',
    nome: 'Fumaça na BR-364',
    perfil: 'raro',
    // "~1x/semana" na estação seca (mesma janela da friagem) -> ≈1/(7*24)h
    mesesElegiveis: [6, 7, 8],
    chancePorHoraNaJanela: 0.006,
    duracaoMs: 4 * HORA_MS,
    jogador: { tipo: 'escondeJogador' },
  },
  {
    id: 'am-cheia-rio-negro',
    uf: 'AM',
    nome: 'Cheia do Rio Negro',
    perfil: 'sazonal',
    mesesElegiveis: [6],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 2 },
  },
  {
    id: 'am-vazante',
    uf: 'AM',
    nome: 'Vazante',
    perfil: 'sazonal',
    mesesElegiveis: [8, 9, 10, 11],
    duracaoMs: null,
    jogador: { tipo: 'saldoInstantaneo', delta: -15 },
  },
  {
    id: 'ap-marabaixo',
    uf: 'AP',
    nome: 'Marabaixo',
    perfil: 'sazonal',
    mesesElegiveis: [11, 12],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 0.5 },
  },
  {
    id: 'ap-mare-araguari',
    uf: 'AP',
    nome: 'Maré do Araguari',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.003,
    duracaoMs: HORA_MS,
    jogador: { tipo: 'precoConta', multiplicador: 1.5 },
    caracol: { tipo: 'velocidadeMundo', multiplicador: 0.85 },
  },
  {
    id: 'pa-cirio-de-nazare',
    uf: 'PA',
    nome: 'Círio de Nazaré',
    perfil: 'sazonal',
    // janela real é a 2a semana de outubro; o catálogo aproxima pro mês
    // inteiro (o motor só resolve elegibilidade por mês, não por semana)
    mesesElegiveis: [10],
    duracaoMs: null,
    jogador: { tipo: 'escudoContaCarga' },
  },
  {
    id: 'pa-microexplosao',
    uf: 'PA',
    nome: 'Microexplosão',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.02,
    duracaoMs: 20 * 60_000, // meio da faixa 15-30min
    caracol: { tipo: 'velocidadeMundo', multiplicador: 1.3 },
  },
  {
    id: 'ro-ramal-intransitavel',
    uf: 'RO',
    nome: 'Ramal Intransitável',
    perfil: 'raro',
    mesesElegiveis: [10, 11, 12, 1, 2, 3, 4, 5],
    chancePorHoraNaJanela: 0.4,
    duracaoMs: 3 * HORA_MS,
    jogador: { tipo: 'precoConta', multiplicador: 2 },
  },
  {
    id: 'rr-fumaca-do-lavrado',
    uf: 'RR',
    nome: 'Fumaça do Lavrado',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4],
    chancePorHoraNaJanela: 0.5,
    duracaoMs: 2 * HORA_MS,
    jogador: { tipo: 'escondeJogador' },
    caracol: { tipo: 'velocidadeMundo', multiplicador: 0.8 },
  },
  {
    id: 'to-seco-do-cerrado',
    uf: 'TO',
    nome: 'Seco do Cerrado',
    perfil: 'sazonal',
    mesesElegiveis: [5, 6, 7, 8, 9],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 1.3 },
  },
  {
    id: 'to-queimada-do-araguaia',
    uf: 'TO',
    nome: 'Queimada do Araguaia',
    perfil: 'raro',
    mesesElegiveis: [8, 9],
    chancePorHoraNaJanela: 0.006,
    duracaoMs: HORA_MS,
    caracol: { tipo: 'velocidadeMundo', multiplicador: 0.75 },
  },
];

export function regionalEventsByUf(uf: string): CaracolRegionalEventDefinition[] {
  return CARACOL_REGIONAL_EVENTS_CATALOG.filter((event) => event.uf === uf);
}
