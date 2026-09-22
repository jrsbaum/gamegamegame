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

  // ---- Região Centro-Oeste (T10) ----
  {
    id: 'go-ipe-em-flor',
    uf: 'GO',
    nome: 'Ipê em Flor',
    perfil: 'raro',
    mesesElegiveis: [7, 8],
    chancePorHoraNaJanela: 0.15,
    duracaoMs: 3 * HORA_MS,
    jogador: { tipo: 'precoConta', multiplicador: 0.5 },
  },
  {
    id: 'go-estiagem-do-cerrado',
    uf: 'GO',
    nome: 'Estiagem do Cerrado',
    perfil: 'sazonal',
    mesesElegiveis: [6, 7, 8, 9],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 2 },
  },
  {
    id: 'mt-fumaca-de-queimada',
    uf: 'MT',
    nome: 'Fumaça de Queimada',
    perfil: 'raro',
    mesesElegiveis: [6, 7, 8, 9],
    chancePorHoraNaJanela: 0.05,
    duracaoMs: 2 * HORA_MS, // meio da faixa 1-3h
    jogador: { tipo: 'escondeJogador' },
    caracol: { tipo: 'velocidadeContraAlvoNoEstado', multiplicador: 1.5 },
  },
  {
    id: 'mt-fauna-do-pantanal-norte',
    uf: 'MT',
    nome: 'Fauna do Pantanal Norte',
    perfil: 'raro',
    // sem estação definida na proposta -> elegível o ano todo
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.1,
    duracaoMs: 10 * 60_000,
    jogador: { tipo: 'saldoInstantaneo', delta: -10 },
  },
  {
    id: 'ms-cheia-do-pantanal',
    uf: 'MS',
    nome: 'Cheia do Pantanal',
    perfil: 'sazonal',
    mesesElegiveis: [11, 12, 1, 2, 3, 4],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 2 },
    caracol: { tipo: 'velocidadeContraAlvoNoEstado', multiplicador: 1.3 },
  },
  {
    id: 'ms-vazante-e-os-peixes-presos',
    uf: 'MS',
    nome: 'Vazante e os Peixes Presos',
    perfil: 'sazonal',
    mesesElegiveis: [5, 6, 7, 8, 9, 10],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 0.5 },
  },
  {
    id: 'df-umidade-critica',
    uf: 'DF',
    nome: 'Umidade Crítica',
    perfil: 'sazonal',
    mesesElegiveis: [5, 6, 7, 8, 9],
    duracaoMs: null,
    jogador: { tipo: 'precoConta', multiplicador: 2 },
  },
  {
    id: 'df-capital-em-festa',
    uf: 'DF',
    nome: 'Capital em Festa',
    perfil: 'raro',
    mesesElegiveis: [11, 12],
    chancePorHoraNaJanela: 0.2,
    duracaoMs: 4 * HORA_MS,
    jogador: { tipo: 'precoConta', multiplicador: 0.5 },
  },

  // ---- Região Sudeste (T11) ----
  {
    id: 'es-nevoeiro-da-serra',
    uf: 'ES',
    nome: 'Nevoeiro da Serra',
    perfil: 'raro',
    mesesElegiveis: [6, 7, 8, 9],
    chancePorHoraNaJanela: 0.05, // "baixa chance" na proposta, sem % explícito
    duracaoMs: 45 * 60_000, // meio da faixa 30-60min
    // proposta pede "esconder o caracol do jogador" (inverso do Blooper);
    // esse lever novo não foi aceito (só ETA borrado, velocidade por local
    // do alvo e bônus resgatável entraram) — usa a alternativa documentada
    // na própria proposta: reaproveitar o Blooper padrão (escondeJogador)
    jogador: { tipo: 'escondeJogador' },
  },
  {
    id: 'es-pedra-azul',
    uf: 'ES',
    nome: 'Pedra Azul',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.02, // cosmético/raro, sem % na proposta
    duracaoMs: 2 * HORA_MS,
    // proposta oferece "sem efeito (flavor) ou desconto ×0.5"; todo evento
    // do catálogo precisa de um efeito (validateCatalog), então o desconto
    // leve foi o escolhido
    jogador: { tipo: 'precoConta', multiplicador: 0.5 },
  },
  {
    id: 'mg-zcas-enchente-na-serra',
    uf: 'MG',
    nome: 'ZCAS: Enchente na Serra',
    perfil: 'raro',
    mesesElegiveis: [10, 11, 12, 1, 2, 3],
    chancePorHoraNaJanela: 0.03,
    duracaoMs: 4 * HORA_MS, // meio da faixa 3-6h
    jogador: { tipo: 'precoConta', multiplicador: 2 },
    caracol: { tipo: 'velocidadeContraAlvoNoEstado', multiplicador: 0.7 },
  },
  {
    id: 'mg-geada-da-mantiqueira',
    uf: 'MG',
    nome: 'Geada da Mantiqueira',
    perfil: 'raro',
    mesesElegiveis: [6, 7, 8],
    chancePorHoraNaJanela: 0.2, // "frequente"
    duracaoMs: 90 * 60_000, // meio da faixa 1-2h
    caracol: { tipo: 'velocidadeMundo', multiplicador: 0.8 },
  },
  {
    id: 'rj-calorao-carioca',
    uf: 'RJ',
    nome: 'Calorão Carioca',
    perfil: 'sazonal',
    mesesElegiveis: [12, 1, 2, 3, 4],
    duracaoMs: null,
    // proposta deixa a polaridade em aberto ("buff ou nerf, ainda por
    // decidir"); escolhido desconto leve para manter o efeito de fundo
    // amigável, já que o evento fica ativo boa parte do verão
    jogador: { tipo: 'precoConta', multiplicador: 0.9 },
  },
  {
    id: 'rj-temporal-de-verao',
    uf: 'RJ',
    nome: 'Temporal de Verão',
    perfil: 'raro',
    mesesElegiveis: [12, 1, 2, 3, 4],
    chancePorHoraNaJanela: 0.05,
    duracaoMs: 3 * HORA_MS, // meio da faixa 2-4h
    jogador: { tipo: 'precoConta', multiplicador: 2 },
    caracol: { tipo: 'velocidadeContraAlvoNoEstado', multiplicador: 0.7 },
  },
  {
    id: 'sp-ilha-de-calor-urbana',
    uf: 'SP',
    nome: 'Ilha de Calor Urbana',
    // "quase estrutural" mas "liga e desliga em blocos de 2-4h" (prosa) ->
    // raro/cíclico com chance alta, não sazonal permanente (sazonal com
    // ALL_MONTHS ficaria ativo o ano inteiro sem nunca desligar, o que
    // contradiz a própria descrição do evento)
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.3,
    duracaoMs: 3 * HORA_MS, // meio da faixa 2-4h
    jogador: { tipo: 'precoConta', multiplicador: 1.15 }, // meio da faixa 1.1-1.2
  },
  {
    id: 'sp-quatro-estacoes-em-um-dia',
    uf: 'SP',
    nome: 'Quatro Estações em Um Dia',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.02,
    duracaoMs: HORA_MS,
    // proposta pede sorteio de buff OU nerf a cada ocorrência; o modelo de
    // dado do catálogo (um efeito fixo por entrada) não representa
    // aleatoriedade de polaridade, então foi escolhido um valor único e
    // suave dentro da faixa ×0.9-1.1 citada
    jogador: { tipo: 'precoConta', multiplicador: 1.05 },
  },

  // ---- Região Sul (T12) ----
  // Nota: o escudo de carga do Círio de Nazaré é do Pará (T8, região Norte),
  // não do Sul; nenhuma entrada abaixo o duplica.
  {
    id: 'pr-geada-da-serra',
    uf: 'PR',
    nome: 'Geada da Serra',
    perfil: 'raro',
    mesesElegiveis: [6, 7, 8],
    chancePorHoraNaJanela: 0.4, // "~40% do tempo"
    duracaoMs: 3 * HORA_MS,
    caracol: { tipo: 'velocidadeMundo', multiplicador: 0.7 }, // "não só contra 1 alvo" -> mundo
  },
  {
    id: 'pr-cataratas-e-itaipu',
    uf: 'PR',
    nome: 'Cataratas do Iguaçu e Itaipu',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.006, // "~1x/semana"
    duracaoMs: 2 * HORA_MS,
    jogador: { tipo: 'precoConta', multiplicador: 0.5 },
  },
  {
    id: 'rs-ciclone-extratropical',
    uf: 'RS',
    nome: 'Ciclone Extratropical',
    perfil: 'raro',
    mesesElegiveis: [5, 6, 7, 8, 9],
    chancePorHoraNaJanela: 0.017, // "~1x/2-3 dias" -> chance por tick de 30min ≈ 1/120
    duracaoMs: 40 * 60_000, // meio da faixa 30-45min
    jogador: { tipo: 'precoConta', multiplicador: 2 },
    caracol: { tipo: 'velocidadeMundo', multiplicador: 2 },
  },
  {
    id: 'rs-bloqueio-atmosferico',
    uf: 'RS',
    nome: 'Bloqueio Atmosférico',
    perfil: 'raro',
    mesesElegiveis: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    chancePorHoraNaJanela: 0.0045, // "muito raro, semanal-quinzenal" -> meio entre 1x/semana e 1x/2semanas
    duracaoMs: 7 * HORA_MS, // meio da faixa 6-8h
    jogador: { tipo: 'precoConta', multiplicador: 1.5 },
  },
  {
    id: 'sc-ciclone-extratropical',
    uf: 'SC',
    nome: 'Ciclone Extratropical',
    perfil: 'raro',
    mesesElegiveis: [5, 6, 7, 8, 9],
    chancePorHoraNaJanela: 0.025, // "um pouco mais frequente que o do RS"
    duracaoMs: 25 * 60_000, // meio da faixa 20-30min
    // a proposta rotula o alvo como "ambos", mas só descreve o multiplicador
    // do caracol ("acelera o caracol em 50%"); nenhum efeito de jogador foi
    // inventado sem base no texto
    caracol: { tipo: 'velocidadeMundo', multiplicador: 1.5 },
  },
  {
    id: 'sc-oktoberfest-de-blumenau',
    uf: 'SC',
    nome: 'Oktoberfest de Blumenau',
    perfil: 'sazonal',
    mesesElegiveis: [10],
    duracaoMs: null,
    // 3º mecanismo novo aceito (bônus disparado pelo próprio jogador,
    // REGCLIM-14); valor fixo não especificado na proposta, escolhido como
    // equivalente aos outros bônus fixos do catálogo (Colheita do Cacau,
    // Serra da Capivara)
    jogador: { tipo: 'bonusResgatavel', valor: 50 },
  },
];

export function regionalEventsByUf(uf: string): CaracolRegionalEventDefinition[] {
  return CARACOL_REGIONAL_EVENTS_CATALOG.filter((event) => event.uf === uf);
}
