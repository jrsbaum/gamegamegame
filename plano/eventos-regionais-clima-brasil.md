# Eventos regionais do Caracol: mapeamento de clima/bioma por estado

Material de referência para desenhar a feature de eventos climáticos/regionais do Caracol.
**Isto não é uma spec** — é o dado bruto (pesquisado via subagentes, com fontes) que alimenta o
brainstorm de que eventos, buffs e nerfs criar por estado. A spec formal só nasce depois que os
eventos concretos estiverem decididos.

## Decisões já tomadas (2026-09-21)

| Decisão | Escolha |
| --- | --- |
| Granularidade | Por estado (27 conjuntos, incluindo DF) |
| Alvo do efeito | Cada evento decide: caracol (global, tipo Raio), jogador do estado (pessoal, tipo Banana), ou os dois |
| Gatilho | Automático e ambiente — muda sozinho com o tempo, sistema paralelo ao da roleta (não reusa o giro de 24h) |

## Como ler ⚠️ sensível

Alguns fenômenos "típicos" de um estado envolvem comunidades indígenas ou quilombolas
especificamente (ex: um festival indígena, um quilombo histórico, uma prática ligada a um povo
determinado). Esses pontos foram deixados **fora** de qualquer proposta de evento de jogo — estão
registrados aqui só como fato geográfico/cultural, marcados com ⚠️, para o dono do projeto decidir
se e como usar (ou simplesmente ignorar). Nenhum eu vou propor por conta própria como fonte de
debuff ("obstáculo") ou buff associado a um grupo específico.

---

## Região Norte

| Estado | Bioma | Clima | Fenômeno extremo notável | Ícone p/ evento |
| --- | --- | --- | --- | --- |
| Acre | Amazônia | Equatorial úmido, ~2.000-2.500mm/ano | **Friagem** (jun-ago, massa de ar polar, cai a 12-14°C); queimadas com fumaça cobrindo a BR-364 | Friagem; fumaça de queimada na estrada |
| Amazonas | Amazônia | Equatorial úmido, quase sem amplitude térmica | **Friagem** (jul-ago); **cheia recorde do Rio Negro** (jun 2021, 30,04m, 455 mil afetados); vazante extrema | Cheia/vazante de rio; Festival de Parintins (boi-bumbá, acesso só por balsa) |
| Amapá | Amazônia + manguezais | Equatorial superúmido, chuvoso (jan-jul) / estiagem (ago-dez) | **Pororoca** do Rio Araguari — hoje extinta (represas), mas ainda ícone cultural | Marabaixo (dança afro-brasileira, patrimônio imaterial) |
| Pará | Amazônia (várzea/terra firme) | Equatorial úmido | Friagens (~7/ano no sul, mai-ago); microexplosões de vento (>45km destruição florestal/ano) | Círio de Nazaré (~2 milhões de pessoas, procissão fluvial); açaí (90% da produção nacional) |
| Rondônia | Transição Amazônia/Cerrado | Equatorial quente, chuvoso (out-mai) / seco (jun-set) | Chuvas intensas viram atoleiros/erosão nos ramais (estradas rurais) | Estrada de terra intransitável na chuva; BR-364 |
| Roraima | Amazônia + Lavrado (savana única) | Savana tropical (Aw), único estado 100% acima da Linha do Equador | **Queimadas recordes** (2024: Normandia 331 mil ha, Lavrado = 93% da área queimada) | Monte Roraima (tepui, fronteira BR/VE/GY); ⚠️ Festival Indígena Anna Eseru (>15% da população é indígena) |
| Tocantins | Cerrado (transição Amazônia/Caatinga) | Tropical savana, seco (mai-set) / chuvoso (out-abr) | Queimadas na seca (ago 2024: 9.901 focos, 332 mil ha no PN do Araguaia) | Rio Araguaia (cheia/vazante, pesca); Festa de São João |

## Região Nordeste

| Estado | Bioma | Clima | Fenômeno extremo notável | Ícone p/ evento |
| --- | --- | --- | --- | --- |
| Alagoas | Mata Atlântica + Caatinga | Transição úmido/semiárido | Seca no interior; enchentes costeiras (2022) | Cachoeiras de Maragogi; açúcar; ⚠️ Quilombo de Palmares (histórico, ligado a Zumbi) |
| Bahia | Caatinga (54%) + Cerrado + Mata Atlântica | Heterogêneo: úmido no litoral, semiárido no interior | Secas prolongadas no sertão; chuvas torrenciais na costa | Cacau (70% da produção nacional); Carnaval de Salvador |
| Ceará | Caatinga (único estado 100% no bioma) | Semiárido, 93% do território, quase sem variação térmica (26-28°C) | **Secas plurianuais severas** (10-20 anos, déficit por 3-5 anos seguidos) | Jangadeiros (Dragão do Mar); São João de Fortaleza |
| Maranhão | Transição Amazônia/Cerrado + manguezais | Semi-úmido, variável norte(úmido)/sul(seco) | Mudanças de padrão de chuva na zona de transição | **Bumba meu boi** (patrimônio UNESCO); **Lençóis Maranhenses** (dunas móveis até 10cm/dia, lagoas dez-abr) |
| Paraíba | Caatinga | Semiárido heterogêneo (chuva varia de 516 a 1083mm conforme microrregião) | Solo pode chegar a 60°C na seca extrema; enchentes/deslizamentos quando chove forte | São João de Campina Grande ("maior do mundo", 33 dias); algodão colorido naturalmente |
| Pernambuco | Caatinga + Mata Atlântica | Heterogêneo litoral úmido/sertão semiárido | Projeção de -30% de chuva no semiárido; enchentes costeiras (Recife/Olinda, 2022) | **Frevo** e **Maracatu** (patrimônio UNESCO); ⚠️ Quilombo de Palmares/Catucá/Conceição das Crioulas |
| Piauí | Caatinga (63%) + Cerrado (37%) | Semiárido (seca até 9 meses) / tropical sazonal no Cerrado | Solos rasos/pedregosos agravam seca | **Serra da Capivara** (patrimônio UNESCO, maior concentração de sítios arqueológicos/pinturas rupestres do mundo); Rio Parnaíba |
| Rio Grande do Norte | Caatinga | Semiárido, chuva concentrada em 3-5 meses | Secas cíclicas (10-20 anos) | **Dunas de Genipabu** (móveis, buggy); RN produz 95% do sal do Brasil |
| Sergipe | Mata Atlântica + Caatinga (menor estado do Brasil) | Transição úmido costeiro/semiárido | Chuvas torrenciais na costa (2022); secas no interior | Cânions do Rio São Francisco (até 80m de altura) |

## Região Centro-Oeste

| Estado | Bioma | Clima | Fenômeno extremo notável | Ícone p/ evento |
| --- | --- | --- | --- | --- |
| Goiás | Cerrado (70%) | Tropical sazonal — chuvoso (out-abr, 95% da chuva) / seco (jun-set) | Umidade relativa pode cair a 9% na seca | Cavalhadas de Pirenópolis; Festa do Divino Pai Eterno; ipês floridos |
| Mato Grosso | Amazônia + Cerrado + Pantanal (3 biomas) | Tropical continental, verão úmido/inverno seco | **Queimadas** (majoritariamente de origem humana); +1,9°C acumulado em 4 décadas no Pantanal | Fauna do Pantanal (onça, tuiuiú, arara-azul); rodovias BR-070/364/163 comprometidas na chuva |
| Mato Grosso do Sul | Pantanal (65% do bioma mundial está aqui) | Tropical continental, cheia (nov-abr) / vazante (mai-out) | **Ciclo de cheia-vazante** — dita toda a vida local | Maior concentração do mundo de jacarés/sucuris; PN do Pantanal Matogrossense |
| Distrito Federal | Cerrado | Tropical de altitude | **Umidade crítica na seca** (chegou a 10%, nível de alerta da OMS, mai-set) | Brasília (capital modernista); ipês |

**Nota**: a seca de maio-setembro afeta a região inteira simultaneamente — candidato natural a um
evento "regional" que liga vários estados ao mesmo tempo, se quisermos essa mecânica no futuro
(fora do escopo do "por estado" decidido agora).

## Região Sudeste

| Estado | Bioma | Clima | Fenômeno extremo notável | Ícone p/ evento |
| --- | --- | --- | --- | --- |
| Espírito Santo | Mata Atlântica | Tropical úmido (litoral) / altitude (serra) | Nevoeiro noturno na serra; seca moderada | **Pedra Azul** (muda de cor ao longo do dia) |
| Minas Gerais | Cerrado + Mata Atlântica | Subtropical de altitude, muito variável por relevo | **ZCAS causa enchentes/deslizamentos graves** (2026: 733mm em dias, 73 mortes); geada na Mantiqueira (-8,4°C recorde) | Mineração (Quadrilátero Ferrífero); serras |
| Rio de Janeiro | Mata Atlântica (100% do estado) | Tropical, seco (mai-out) / chuvoso (dez-abr) | Estresse térmico intenso no verão; **ZCAS traz deslizamentos** em encostas urbanas | Cristo Redentor; Parque Nacional da Tijuca |
| São Paulo | Mata Atlântica (remanescente) | Subtropical úmido, "quatro estações num dia" | **Ilhas de calor urbanas** (diferença de até 12°C entre bairros) | Congestionamento (Dutra, Régis Bittencourt); metrô/hub logístico |

## Região Sul

| Estado | Bioma | Clima | Fenômeno extremo notável | Ícone p/ evento |
| --- | --- | --- | --- | --- |
| Paraná | Mata Atlântica (98%) | Subtropical, Curitiba é a capital mais fria do Brasil | **Geada** frequente no planalto (~10 dias/mês no inverno); granizo, chuva congelada | Cataratas do Iguaçu; Itaipu |
| Rio Grande do Sul | Pampa (único bioma restrito a 1 estado, 2/3 do território) | Temperado/subtropical úmido, sem estação seca definida | Bloqueios atmosféricos (secas ou enchentes prolongadas); ciclones extratropicais (>100km/h) | Churrasco gaúcho; ⚠️ cultura gaúcha/tropeirismo tem raiz indígena/mestiça — cuidado ao romantizar |
| Santa Catarina | Mata Atlântica (100%) | Subtropical oceânico, uma das regiões mais úmidas do Brasil (1.100-2.900mm/ano) | **Ciclones extratropicais** (ventos 70-100+km/h, 140+ municípios afetados em eventos recentes) | Oktoberfest de Blumenau (2ª maior do mundo); ⚠️ imigração alemã/italiana teve contexto de "branqueamento" — cuidado ao romantizar |

---

## Ideias de eventos (rascunho para discutir, não é proposta fechada)

Categorias que dá pra tirar do mapeamento acima, todas reaproveitando o sistema de efeito que já
existe na roleta (`caracol_effects`: escopo `account`/`world`, duração OU carga, nunca timer
agendado — ver `.notebook/caracol-servidor-motor-e-roleta.md`):

1. **Clima ambiente** (chuva, seca, calor/frio, geada, neblina) — o mais frequente, efeito leve.
   Ex: seca no Ceará/RN/PB reduz visibilidade de distância/ETA pro jogador daquele estado; friagem
   no Norte desacelera levemente o caracol se o alvo estiver lá (analogia ao frio "atrasar" tudo).
2. **Fenômeno extremo** (enchente, deslizamento, ciclone, queimada, cheia de rio) — raro, efeito
   forte. Ex: ciclone extratropical em SC/RS acelera o caracol global por N horas (rajada); enchente
   em MG/RJ (ZCAS) imobiliza redirect pra quem está lá (estradas cortadas).
3. **Evento cultural sazonal** (festa regional com data real) — cosmético/econômico, não hostil. Ex:
   Festival de Parintins, São João nordestino, Oktoberfest, Círio de Nazaré: desconto temporário ou
   bônus de moeda pra quem está na cidade/estado durante a janela real do evento.
4. **Fauna/hazard local** — flavor de debuff curto. Ex: jacarés/sucuris no Pantanal (MS/MT), onça
   (MT/Cerrado) — mais sabor narrativo que mecânica pesada.
5. **Infra/estrada** — ligado a transporte real do estado. Ex: estrada de terra intransitável em
   RO na chuva (redirect mais caro); congestionamento de SP (redirect mais lento).

**Itens explicitamente fora de qualquer proposta acima** (marcados ⚠️ nas tabelas): festivais
indígenas nomeados, quilombos históricos específicos, e a moldura étnica da cultura gaúcha e da
imigração europeia de SC. Nenhum vira "evento" sem uma decisão explícita sua sobre como (ou se)
enquadrar.

---

## Proposta de eventos concretos (brainstorm de 5 "pensadores", 2026-09-21)

Cada região foi pensada por um fork independente, mas as cinco convergiram sozinhas no mesmo
padrão de frequência — sinal de que é o formato certo, não coincidência forçada. Ver síntese no
final desta seção antes das tabelas por estado.

### Convergência: frequência e mecanismo (as 5 regiões concordaram)

- **Tick de reavaliação**: a cada 15-30 minutos por estado — nunca no tick de 1s do movimento do
  caracol. Reusa o mesmo princípio de "derivar do relógio, nunca agendar" já usado em
  `settleCoins()`/efeitos da roleta.
- **Quantos estados ativos ao mesmo tempo**: teto de ~4-8 dos 27, não todos — senão vira ruído
  visual constante e perde leitura. Cada estado tem uma chance própria de "ganhar" evento a cada
  checagem, não é tudo-ou-nada.
- **Dois tipos de gatilho, com regra de equilíbrio oposta**:
  - **Sazonal/passivo** (seca, cheia, geada, ilha de calor) — liga sozinho durante a janela real do
    fenômeno (dias a meses), sem sorteio; efeito deliberadamente **fraco**, porque é quase
    permanente.
  - **Raro/pontual** (ciclone, queimada, microexplosão, festa cultural) — sorteio de baixa chance
    a cada tick, dentro da janela sazonal certa; efeito pode ser **forte**, porque é raro.
- **Nada de lever novo, quase sempre** — os 27 estados encaixaram quase todos os eventos nos
  levers que já existem (Moeda = desconto, Raio = preço em dobro, Banana = acelera perseguição
  contra o alvo, Blooper = esconde posição, Casco defensivo = escudo, Bomba/Bumerangue = saldo
  instantâneo). Só 3 exceções pediram mecanismo novo, listadas abaixo.

### 3 pedidos de lever novo (nenhum implementado ainda — decisão em aberto)

1. **ETA borrado** (Ceará "Seca do Sertão"): mostrar uma faixa aproximada em vez do ETA exato do
   caracol, em vez de esconder tudo (Blooper já existente esconde por completo).
2. **Velocidade do caracol amarrada à localização do alvo, não a um item possuído** (Maranhão
   "Lençóis em Movimento", MG "ZCAS"): hoje só a Banana (item possuído por uma conta) muda a
   velocidade contra um alvo; aqui o gatilho seria "o alvo está neste estado agora", não "o alvo
   tem este item".
3. **Evento-calendário com ação disparável** (SC "Oktoberfest"): um bônus que o jogador aciona
   (não que simplesmente recebe passivamente) dentro de uma janela de data real. Alternativa mais
   simples, sem lever novo: tratar como desconto passivo (Moeda) o mês inteiro.

### Norte

| Estado | Evento | Gatilho | Alvo | Efeito (lever) | Duração |
| --- | --- | --- | --- | --- | --- |
| Acre | Friagem | ~30%/h, jun-ago | Caracol | Desacelera ×0.7 (Banana invertida) | 2h |
| Acre | Fumaça na BR-364 | Raro, ~1x/semana, seca | Jogador | Esconde posição (Blooper) | 4h ou 1 uso |
| Amazonas | Cheia do Rio Negro | Sempre ativo no pico (jun) | Jogador | Redirect/aceleração ×2 (Raio pessoal) | Sazonal |
| Amazonas | Vazante | Sempre ativo na seca | Jogador | Perda instantânea pequena (Bomba) | Instantâneo |
| Amapá | Marabaixo (festa) | Janela real nov-dez | Jogador | Desconto ×0.5 (Moeda) | Semanas |
| Amapá | Maré do Araguari (eco da Pororoca) | Raro, ~1x/2 semanas | Ambos | Caracol ×0.85, redirect ×1.5 | 1h |
| Pará | Círio de Nazaré | Janela real, 2ª semana de out | Jogador | Escudo 1 uso (Casco defensivo) | 1 semana / 1 uso |
| Pará | Microexplosão (vento) | Raro, ~2%/h, ano todo | Caracol | Acelera ×1.3 (Banana world-scoped) | 15-30min |
| Rondônia | Ramal Intransitável | ~40%/h, out-mai | Jogador | Redirect ×2 (Raio pessoal) | 3h, renovável |
| Roraima | Fumaça do Lavrado | ~50%/h, jan-abr | Ambos | Esconde jogador + caracol ×0.8 | 2h |
| Tocantins | Seco do Cerrado | Sempre ativo, mai-set | Jogador | Redirect ×1.3 (fraco, contínuo) | Sazonal |
| Tocantins | Queimada do Araguaia | Raro, ~1x/semana, ago-set | Caracol | Desacelera ×0.75 | 1h |

### Nordeste

| Estado | Evento | Gatilho | Alvo | Efeito (lever) | Duração |
| --- | --- | --- | --- | --- | --- |
| Alagoas | Maré de Ressaca | ~1x/6h, estação chuvosa | Jogador | Redirect ×1.5 | 2h |
| Alagoas | Doce de Cana | Sempre ativo, dispara 1x/dia | Jogador | Desconto ×0.7, 1 uso | 1 uso / 4h |
| Bahia | Colheita do Cacau | 1x/semana, dia fixo | Jogador | +30 moedas instantâneo (Bumerangue) | 1 uso |
| Bahia | Vento de Leste | ~5%/30min, estação chuvosa | Caracol | Acelera ×1.2 contra o alvo | 3h |
| Ceará | Seca do Sertão | Sempre ativo, estação seca | Jogador | ETA borrado (⚠️ lever novo) ou sync ×1.5 | Sazonal |
| Ceará | Regata Dragão do Mar | Raro/cultural | Jogador | Desconto aceleração ×0.5, 1 uso | 1 uso |
| Maranhão | Bumba Meu Boi | Janela real jun-ago | Jogador | Desconto ×0.7 | Dias |
| Maranhão | Lençóis em Movimento | Raro, ~1x/2 semanas, dez-abr | Caracol | Desacelera ×0.8 (⚠️ lever novo: por local do alvo) | 1h |
| Paraíba | Maior São João do Mundo | Janela real jun-jul | Jogador | Desconto ×0.7 | Dias |
| Paraíba | Solo Rachado | ~5%/30min, seca extrema | Jogador | Redirect ×1.3 | 2h |
| Pernambuco | Frevo de Carnaval | Janela real, carnaval | Jogador | +50 moedas + desconto ×0.8 | Dias |
| Pernambuco | Vazio Climático | Contínuo e fraco, seca | Caracol | Acelera ×1.1 contra o alvo | 4h |
| Piauí | Serra da Capivara (achado) | Raro, ~1x/2 semanas | Jogador | +40 moedas, 1 uso | 1 uso |
| Piauí | Seca de 9 Meses | Sempre ativo, estação seca | Jogador | Aceleração ×1.15 (fraco, contínuo) | Sazonal |
| RN | Areia em Movimento (Genipabu) | Raro, ~1x/2 semanas | Jogador | Blooper pessoal, 30min | 30min |
| RN | Cristalização do Sal | Raro, ~1x/semana | Jogador | Desconto ×0.6, 1 uso | 1 uso |
| Sergipe | Cânions do São Francisco | Raro, ~1x/2 semanas | Jogador | Desconto redirect ×0.7, 1 uso | 1 uso |
| Sergipe | Chuva Torrencial Costeira | ~5%/30min, estação chuvosa | Caracol | Acelera ×1.15 contra o alvo | 2h |

### Centro-Oeste

| Estado | Evento | Gatilho | Alvo | Efeito (lever) | Duração |
| --- | --- | --- | --- | --- | --- |
| Goiás | Ipê em Flor | ~15%/h, jul-ago | Jogador | Desconto ×0.5 (Moeda) | 3h |
| Goiás | Estiagem do Cerrado | Sempre ativo, jun-set | Jogador | Redirect/aceleração ×2 (fraco por ser de fundo — nota: ver observação abaixo) | Sazonal |
| Mato Grosso | Fumaça de Queimada | ~5%/h, jun-set | Ambos | Esconde jogador + acelera caracol ×1.5 contra ele | 2h |
| Mato Grosso | Fauna do Pantanal Norte | ~10%/h | Jogador | Perda instantânea pequena (Bomba) | Instantâneo |
| Mato Grosso do Sul | Cheia do Pantanal | Sempre ativo, nov-abr | Ambos | Redirect p/ fora ×2, caracol ×1.3 contra alvo no MS | Sazonal (mais forte da região) |
| Mato Grosso do Sul | Vazante e os Peixes Presos | Sempre ativo, mai-out | Jogador | Desconto loja ×0.5 | Sazonal |
| DF | Umidade Crítica | Sempre ativo, mai-set | Jogador | Redirect/aceleração/loja ×2 | Sazonal |
| DF | Capital em Festa | ~20%/h, nov-dez | Jogador | Desconto ×0.5 | 4h |

**Ideia extra (fora do escopo "por estado", avaliar separado)**: um evento "Seca do Centro-Oeste"
que liga os 4 ao mesmo tempo (mai-set) com efeito mais fraco que o individual — a região inteira
seca junto na realidade.

### Sudeste

| Estado | Evento | Gatilho | Alvo | Efeito (lever) | Duração |
| --- | --- | --- | --- | --- | --- |
| Espírito Santo | Nevoeiro da Serra | Baixa chance, madrugadas jun-set | Jogador | Esconde caracol do jogador (Blooper invertido, ⚠️ lever novo — ou reusar Blooper padrão) | 30-60min |
| Espírito Santo | Pedra Azul | Raro, cosmético | Jogador | Sem efeito (flavor) ou desconto ×0.5 | 2h |
| Minas Gerais | ZCAS: Enchente na Serra | Raro, out-mar | Ambos | Redirect ×2 pessoal, caracol desacelera contra alvo em MG | 3-6h |
| Minas Gerais | Geada da Mantiqueira | Frequente, jun-ago | Caracol | Desacelera ×0.8 (fraco) | 1-2h |
| Rio de Janeiro | Calorão Carioca | Frequente, dez-abr | Jogador | Desconto ou custo leve ×0.8-1.2 (polaridade é decisão de tom) | 1-3h |
| Rio de Janeiro | Temporal de Verão | Raro, dez-abr | Ambos | Redirect ×2 pessoal, caracol desacelera contra alvo no RJ | 2-4h |
| São Paulo | Ilha de Calor Urbana | Intermitente, quase estrutural | Jogador | Redirect ×1.1-1.2 (fraco) | 2-4h por ciclo |
| São Paulo | Quatro Estações em Um Dia | Raro, imprevisível | Jogador | Sorteia buff OU nerf pequeno (×0.9-1.1) | 1h |

**Nota de balanceamento (RJ/SP)**: por serem estados com mais jogadores prováveis (cidades
grandes), o fork sugere eventos fortes mais raros ali, e eventos fracos/ambiente mais frequentes —
mantém o efeito médio por jogador parecido entre estados grandes e pequenos.

### Sul

| Estado | Evento | Gatilho | Alvo | Efeito (lever) | Duração |
| --- | --- | --- | --- | --- | --- |
| Paraná | Geada da Serra | ~40% do tempo, jun-ago | Caracol | Desacelera ×0.7 global (não só contra 1 alvo) | 3h |
| Paraná | Cataratas/Itaipu (turismo) | Raro, ~1x/semana | Jogador | Desconto ×0.5 | 2h |
| Rio Grande do Sul | Ciclone Extratropical | Raro, ~1x/2-3 dias, mai-set | Ambos | Caracol ×2 (forte, curto), redirect ×2 pessoal | 30-45min |
| Rio Grande do Sul | Bloqueio Atmosférico | Muito raro, semanal-quinzenal | Jogador | Redirect/aceleração/loja ×1.5 | 6-8h (longo) |
| Santa Catarina | Ciclone Extratropical (costeiro) | Raro, mai-set, um pouco mais frequente que RS | Ambos | Caracol ×1.5 (mais fraco que o do RS — "também atingido" vs. "epicentro") | 20-30min |
| Santa Catarina | Oktoberfest de Blumenau | Fixo, outubro, ~15-20 dias | Jogador | Bônus ao entrar no estado (⚠️ lever novo: ação disparável) ou desconto passivo (Moeda) o mês todo | Mês |

---

## O que falta decidir antes de virar spec

1. Confirmar (ou cortar) os 3 pedidos de lever novo — ETA borrado, velocidade do caracol por
   localização do alvo, evento-calendário com ação disparável. Cada um tem uma alternativa que
   reusa 100% do que já existe, listada ao lado.
2. Escolher a granularidade de tick real (15min? 30min?) e o teto de estados simultâneos (4? 8?).
3. Decidir a polaridade de 2-3 eventos que os pensadores deixaram como "chamada de tom" (ex:
   Calorão Carioca — buff ou nerf?).
4. Filtrar a lista: são ~50 eventos propostos (27 estados × ~2 cada) — provavelmente mais do que
   cabe numa primeira versão. Escolher um subconjunto pra v1 (ex: 1 por estado) é decisão do dono
   do projeto.

## Fontes

As fontes completas (uma por afirmação estatística) estão nos relatórios brutos dos 5 subagentes de
pesquisa que geraram esta tabela (Wikipédia PT, Embrapa, IPHAN, InfoEscola, Metsul, e imprensa
regional — cada linha da tabela é rastreável a uma fonte citada pelo agente correspondente).

Updated: 2026-09-21
