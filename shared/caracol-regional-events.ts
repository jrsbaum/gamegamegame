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

  // ---- Região Nordeste (T9) ----
  {
    id: 'al-mare-de-ressaca',
    uf: 'AL',
    nome: 'Maré de Ressaca',
    perfil: 'raro',
    mesesElegiveis: [4, 5, 6, 7],
    chancePorHoraNaJanela: 0.167, // "~1x/6h" -> chance por tick de 30min = 1/12
    duracaoMs: 2 * HORA_MS,
    jogador: { tipo: 'precoConta', multiplicador: 1.5 },
  },
  {
    id: 'al-doce-de-cana',
    uf: 'AL',
    nome: 'Doce de Cana',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.042, // "dispara 1x/dia" -> chance por tick de 30min = 1/48
    duracaoMs: 4 * HORA_MS, // cupom expira em 4h se não usado
    jogador: { tipo: 'precoConta', multiplicador: 0.7 },
  },
  {
    id: 'ba-colheita-do-cacau',
    uf: 'BA',
    nome: 'Colheita do Cacau',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.006, // "1x/semana, dia fixo"
    duracaoMs: 10 * 60_000,
    jogador: { tipo: 'saldoInstantaneo', delta: 30 },
  },
  {
    id: 'ba-vento-de-leste',
    uf: 'BA',
    nome: 'Vento de Leste',
    perfil: 'raro',
    mesesElegiveis: [4, 5, 6, 7],
    chancePorHoraNaJanela: 0.1, // "~5%/30min" -> chance por hora = 2x
    duracaoMs: 3 * HORA_MS,
    caracol: { tipo: 'velocidadeContraAlvoNoEstado', multiplicador: 1.2 },
  },
  {
    id: 'ce-seca-do-sertao',
    uf: 'CE',
    nome: 'Seca do Sertão',
    perfil: 'sazonal',
    mesesElegiveis: [7, 8, 9, 10, 11, 12, 1],
    duracaoMs: null,
    jogador: { tipo: 'etaBorrado', passoMinutos: 15, passoKm: 5 },
  },
  {
    id: 'ce-regata-dragao-do-mar',
    uf: 'CE',
    nome: 'Regata Dragão do Mar',
    perfil: 'raro',
    // "raro/cultural" sem estação definida na proposta -> elegível o ano todo
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.006,
    duracaoMs: 10 * 60_000,
    jogador: { tipo: 'precoConta', multiplicador: 0.5 },
  },
  {
    id: 'ma-bumba-meu-boi',
    uf: 'MA',
    nome: 'Bumba Meu Boi',
    perfil: 'sazonal',
    mesesElegiveis: [6, 7, 8],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 0.7 },
  },
  {
    id: 'ma-lencois-em-movimento',
    uf: 'MA',
    nome: 'Lençóis em Movimento',
    perfil: 'raro',
    mesesElegiveis: [12, 1, 2, 3, 4],
    chancePorHoraNaJanela: 0.003, // "~1x/2 semanas"
    duracaoMs: HORA_MS,
    caracol: { tipo: 'velocidadeContraAlvoNoEstado', multiplicador: 0.8 },
  },
  {
    id: 'pb-maior-sao-joao-do-mundo',
    uf: 'PB',
    nome: 'Maior São João do Mundo',
    perfil: 'sazonal',
    mesesElegiveis: [6, 7],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 0.7 },
  },
  {
    id: 'pb-solo-rachado',
    uf: 'PB',
    nome: 'Solo Rachado',
    perfil: 'raro',
    mesesElegiveis: [9, 10, 11, 12],
    chancePorHoraNaJanela: 0.1, // "~5%/30min" -> chance por hora = 2x
    duracaoMs: 2 * HORA_MS,
    jogador: { tipo: 'precoConta', multiplicador: 1.3 },
  },
  {
    id: 'pe-frevo-de-carnaval',
    uf: 'PE',
    nome: 'Frevo de Carnaval',
    perfil: 'sazonal',
    mesesElegiveis: [2, 3],
    duracaoMs: null,
    // proposta pede bônus + desconto; a definição de evento só aceita 1
    // efeito de jogador, então o desconto (sustentado por toda a janela do
    // carnaval) foi o escolhido como representante, em vez do crédito único
    jogador: { tipo: 'precoConta', multiplicador: 0.8 },
  },
  {
    id: 'pe-vazio-climatico',
    uf: 'PE',
    nome: 'Vazio Climático',
    perfil: 'sazonal',
    mesesElegiveis: [9, 10, 11, 12],
    duracaoMs: null,
    caracol: { tipo: 'velocidadeContraAlvoNoEstado', multiplicador: 1.1 },
  },
  {
    id: 'pi-serra-da-capivara',
    uf: 'PI',
    nome: 'Serra da Capivara',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.003, // "~1x/2 semanas"
    duracaoMs: 10 * 60_000,
    jogador: { tipo: 'saldoInstantaneo', delta: 40 },
  },
  {
    id: 'pi-seca-de-9-meses',
    uf: 'PI',
    nome: 'Seca de 9 Meses',
    perfil: 'sazonal',
    mesesElegiveis: [3, 4, 5, 6, 7, 8, 9, 10, 11],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 1.15 },
  },
  {
    id: 'rn-areia-em-movimento',
    uf: 'RN',
    nome: 'Areia em Movimento',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.003, // "~1x/2 semanas"
    duracaoMs: 30 * 60_000,
    jogador: { tipo: 'escondeJogador' },
  },
  {
    id: 'rn-cristalizacao-do-sal',
    uf: 'RN',
    nome: 'Cristalização do Sal',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.006, // "~1x/semana"
    duracaoMs: 10 * 60_000,
    jogador: { tipo: 'precoConta', multiplicador: 0.6 },
  },
  {
    id: 'se-canions-do-sao-francisco',
    uf: 'SE',
    nome: 'Cânions do Rio São Francisco',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.003, // "~1x/2 semanas"
    duracaoMs: 10 * 60_000,
    jogador: { tipo: 'precoConta', multiplicador: 0.7 },
  },
  {
    id: 'se-chuva-torrencial-costeira',
    uf: 'SE',
    nome: 'Chuva Torrencial Costeira',
    perfil: 'raro',
    mesesElegiveis: [4, 5, 6, 7],
    chancePorHoraNaJanela: 0.1, // "~5%/30min" -> chance por hora = 2x
    duracaoMs: 2 * HORA_MS,
    caracol: { tipo: 'velocidadeContraAlvoNoEstado', multiplicador: 1.15 },
  },
];

export function regionalEventsByUf(uf: string): CaracolRegionalEventDefinition[] {
  return CARACOL_REGIONAL_EVENTS_CATALOG.filter((event) => event.uf === uf);
}
