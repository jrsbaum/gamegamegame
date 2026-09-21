# Eventos regionais do Caracol: proposta completa

Status: a revisar. Nada disto está implementado. É a lista completa dos 50 eventos propostos por
cinco pensadores independentes, um por região do Brasil, para você aprovar, cortar ou ajustar antes
de qualquer spec ou código.

O material bruto (clima e bioma por estado, com fontes) está em
`eventos-regionais-clima-brasil.md`, na mesma pasta. Este documento explica cada evento em prosa:
o que dispara, quem afeta, o que muda no jogo e por quanto tempo.

## Como o sistema funcionaria

Três decisões já foram tomadas antes do brainstorm dos eventos em si:

- Um estado é a unidade de evento (os 26 estados mais o Distrito Federal), não bioma nem região.
- Cada evento escolhe seu próprio alvo: pode afetar só o caracol (efeito global, como o item Raio
  da roleta hoje), só o jogador que está naquele estado (efeito pessoal, como a Banana), ou os
  dois ao mesmo tempo.
- O clima muda sozinho, num relógio próprio, sem depender da roleta que já existe (aquela do giro
  de 24 horas).

Os cinco pensadores, trabalhando cada um na sua região sem ver o trabalho dos outros, chegaram ao
mesmo desenho de sistema por conta própria. Isso é um bom sinal de que o formato é natural para o
problema, não uma coincidência forçada:

O servidor reavaliaria o clima de cada estado a cada 15 a 30 minutos, nunca no tick de um segundo
que já move o caracol hoje. A cada checagem, um número pequeno de estados (a proposta gira em
torno de 4 a 8, nunca os 27 juntos) ganharia ou perderia um evento ativo. Isso mantém o mapa
legível: se todo estado tivesse evento o tempo todo, a informação viraria ruído e ninguém prestaria
atenção nela.

Dentro disso, os eventos se dividem em dois perfis com uma regra de equilíbrio oposta. Fenômenos
sazonais e de longa duração (uma seca de meses, uma cheia de rio) ficam ativos sozinhos durante a
janela real do fenômeno, sem sorteio, mas com efeito fraco, porque duram muito. Fenômenos raros e
pontuais (um ciclone, uma queimada, uma festa) dependem de sorteio de baixa probabilidade dentro da
janela certa, mas podem ter efeito forte, porque a raridade limita o impacto total.

Quase todos os 50 eventos encaixam nos efeitos que a roleta já usa hoje: desconto de preço (como a
Moeda), preço em dobro (como o Raio), acelerar a perseguição contra um alvo (como a Banana),
esconder a posição de alguém (como o Blooper), um escudo de uma carga (como o Casco defensivo), ou
ganho/perda instantânea de moedas (como a Bomba e o Bumerangue). Só três eventos, entre os 50,
pediram um mecanismo que ainda não existe no jogo. Eles aparecem marcados abaixo e têm uma
alternativa proposta que não exige nada novo, caso você prefira não abrir esse escopo agora.

Um símbolo de atenção (⚠️) aparece nos poucos pontos em que o fenômeno real do estado toca uma
comunidade indígena ou quilombola específica. Nesses casos, o pensador responsável evitou propor
qualquer evento em cima disso, e o símbolo serve só para registrar o fato, não para sugerir uso.

---

## Região Norte

### Acre

Dois eventos, ambos ligados à estação seca (junho a agosto). O primeiro, a friagem, é a queda real
de temperatura que a região sofre nesses meses por causa de uma massa de ar polar vinda do sul.
Enquanto ativa, ela desacelera o caracol inteiro em 30%, do mesmo jeito que a Banana acelera, só
que ao contrário, e dura cerca de duas horas por ocorrência, com chance de cerca de 30% por hora
durante a janela. O segundo evento é a fumaça que a queimada sazonal joga sobre a BR-364, a
principal rodovia do estado. É mais raro (cerca de uma vez por semana) e esconde a posição do
jogador que está no Acre, como o Blooper, por quatro horas ou até o caracol tentar localizá-lo uma
vez.

### Amazonas

A cheia do Rio Negro é o evento mais forte da região, porque é o mais documentado: em 2021 bateu
recorde histórico e afetou mais de 450 mil pessoas. Fica ativa sozinha durante o pico real da cheia
(junho) e dobra o custo de redirecionar e acelerar para quem estiver no Amazonas, o mesmo efeito do
Raio, mas só para essa pessoa, não para o mundo inteiro. No outro extremo do ano, a vazante faz o
oposto: tira moedas na hora, um pouco de cada vez, refletindo a dificuldade real de comunidades
ribeirinhas em period de seca extrema dos rios.

### Amapá

O Marabaixo, dança afro-brasileira reconhecida como patrimônio cultural, vira um evento de
novembro-dezembro que dá desconto de metade do preço em qualquer compra, sem punir ninguém. É
flavor de festa, não de risco. Já a maré do Araguari lembra a Pororoca, o fenômeno de ondas de até
quatro metros que existiu de verdade no rio até 2013 e hoje só existe como memória cultural. Como
evento de jogo, ela é rara (a cada duas semanas, mais ou menos) e afeta os dois lados: desacelera
um pouco o caracol e encarece o redirect de quem está no Amapá, por uma hora.

### Pará

O Círio de Nazaré reúne cerca de dois milhões de pessoas em outubro, e a multidão vira um escudo de
uma carga para quem está lá durante a semana do evento, o mesmo efeito do Casco defensivo. As
microexplosões, rajadas de vento que já destruíram mais de 45 km² de floresta por ano na Amazônia
Central, são um evento raro e rápido: aceleram o caracol em 30% por quinze a trinta minutos, sem
depender de estação.

### Rondônia

Um único evento, ligado à chuva de outubro a maio: os ramais, as estradas de terra que ligam
famílias rurais à cidade, viram lama e dobram o custo de redirecionar para quem está no estado, por
três horas, renovável se a chuva continuar.

### Roraima

O estado com o fenômeno mais extremo documentado na região: em 2024, 93% de toda a área queimada em
Roraima ficou no Lavrado, a savana única do estado. O evento correspondente, ativo de janeiro a
abril com chance de metade por hora, é o único da região com efeito duplo por padrão: esconde o
jogador que está lá e desacelera o caracol em 20%, os dois ao mesmo tempo, por duas horas.

### Tocantins

A seca do cerrado, de maio a setembro, é passiva e fraca: encarece o redirect em apenas 30%,
porque fica ativa a estação inteira e um efeito forte durante meses quebraria o jogo. Já a queimada
do Araguaia, que em 2024 consumiu 332 mil hectares num único incêndio dentro do parque nacional, é
rara (uma vez por semana em agosto-setembro) e desacelera o caracol inteiro em 25% por uma hora.

## Região Nordeste

### Alagoas

A maré de ressaca, ligada à estação chuvosa costeira, encarece o redirect em 50% por duas horas,
com chance de ocorrer a cada seis horas de janela ativa. O doce de cana, ligado à economia
açucareira do estado, dá um desconto de 30% numa única compra por dia, como um cupom que expira se
não for usado em quatro horas.

### Bahia

A colheita do cacau, referência aos 70% da produção nacional que vêm da Bahia, dá um bônus fixo de
moedas uma vez por semana, num dia marcado. O vento de leste, chuva torrencial típica da estação
úmida, acelera o caracol em 20% contra quem está no estado, por três horas, com chance baixa a cada
meia hora dentro da janela.

### Ceará

O Ceará é o único estado inteiramente dentro do bioma Caatinga, e sua seca costuma durar anos
seguidos. O evento correspondente fica ativo a estação toda e propõe reduzir a precisão do horário
estimado de chegada do caracol que o próprio jogador vê, em vez de escondê-lo por completo como o
Blooper já faz. Essa é uma das três ideias que pedem mecanismo novo; a alternativa mais simples,
sem abrir esse escopo, é encarecer levemente o custo de sincronizar o estado (30% a mais), efeito
que já existe. A regata Dragão do Mar, celebração dos jangadeiros históricos do estado, é cultural e
rara, e dá desconto de metade do preço de acelerar numa única vez.

### Maranhão

O Bumba meu boi, patrimônio da UNESCO, é o evento cultural mais longo da lista: fica ativo por dias
inteiros durante a janela real (junho a agosto) e dá desconto de 30% em qualquer compra. Os Lençóis
Maranhenses, cujas dunas se movem sozinhas até dez centímetros por dia, inspiram um evento raro (a
cada duas semanas, no período chuvoso de dezembro a abril) que desacelera o caracol em 20% quando o
alvo dele está no Maranhão. Esse "quando o alvo está lá" é a segunda das três ideias que pedem
mecanismo novo: hoje só um item que uma conta possui muda a velocidade da perseguição contra ela; a
proposta aqui é que a localização do próprio alvo, sozinha, faça isso.

### Paraíba

O São João de Campina Grande, que a cidade chama de maior do mundo, segue o mesmo padrão do Bumba
meu boi: desconto de 30% durante a janela real de junho-julho, por dias. O solo rachado, referência
ao calor que passa de 60 graus no Cariri paraibano durante a seca extrema, encarece o redirect em
30% por duas horas, com chance baixa.

### Pernambuco

O frevo e o carnaval dão um bônus de moedas mais um desconto de 20%, durante a janela real do
carnaval. O vazio climático, referência à projeção de queda de 30% na chuva do semiárido
pernambucano, é fraco e contínuo: acelera o caracol em apenas 10% contra quem está no estado.

### Piauí

A Serra da Capivara, com a maior concentração de sítios arqueológicos do mundo, vira um evento raro
e puramente positivo: um bônus fixo de moedas, sem nenhum lado ruim, porque o fenômeno em si não
tem carga climática, só cultural. A seca de nove meses, a mais longa documentada entre os estados
do Nordeste, é passiva e propositalmente fraca: 15% a mais no custo de acelerar, durante toda a
estação seca.

### Rio Grande do Norte

As dunas de Genipabu, que se movem todo dia com o vento, dão ao jogador um Blooper pessoal por meia
hora, como se as dunas escondessem o caminho. A cristalização do sal, referência aos 95% do sal
nacional que saem do Rio Grande do Norte, dá desconto de 40% numa única compra.

### Sergipe

Os cânions do Rio São Francisco, com até 80 metros de altura, dão desconto de 30% no redirect numa
única vez. A chuva torrencial costeira segue o mesmo padrão de Alagoas e Bahia: acelera o caracol em
15% contra quem está no estado durante a estação chuvosa.

## Região Centro-Oeste

### Goiás

O ipê em flor, que colore o cerrado em julho-agosto durante a própria seca, dá desconto de metade
do preço por três horas, com chance de 15% por hora nessa janela. A estiagem do cerrado, ativa de
junho a setembro, é o evento sazonal passivo do estado: dobra o custo de redirecionar e acelerar
enquanto durar a seca, mesmo efeito do Raio, só que de fundo em vez de sorteado.

### Mato Grosso

A fumaça de queimada, fenômeno mais documentado do estado, tem efeito duplo: esconde o jogador que
está lá e acelera o caracol em 50% contra ele, porque a fumaça atrapalha os dois lados igual. É raro
(5% de chance por hora) e dura de uma a três horas, concentrado em junho-setembro. A fauna do
Pantanal Norte é só flavor: tira um pouco de moeda na hora, como se uma onça tivesse assustado o
gado.

### Mato Grosso do Sul

O Pantanal concentra 65% de todo o bioma no Mato Grosso do Sul, e o ciclo de cheia e vazante dita a
vida real da região. Por isso o evento da cheia (novembro a abril) é o mais forte de toda a proposta
do Centro-Oeste: encarece em dobro o redirect para fora do estado e acelera o caracol em 30% contra
quem está lá, os dois efeitos ativos a estação inteira. A vazante, de maio a outubro, inverte para
buff: desconto de metade do preço na loja, refletindo a pesca farta que a água baixa deixa exposta.

### Distrito Federal

A umidade do DF já chegou a 10% durante a seca, nível que a Organização Mundial da Saúde trata como
alerta. O evento correspondente, ativo de maio a setembro, dobra o custo de redirecionar, acelerar e
comprar, o efeito de seca mais forte entre os quatro estados da região, porque o dado real também é
o mais extremo. A capital em festa, ligada ao calendário cultural de novembro-dezembro, dá desconto
de metade do preço por quatro horas.

Uma ideia extra, fora do escopo "por estado" já decidido: como a seca de maio a setembro atinge os
quatro lugares da região ao mesmo tempo na vida real, dava para ter um evento amplo que ligasse
Goiás, Mato Grosso, Mato Grosso do Sul e o DF juntos, com efeito mais fraco que o individual de cada
um. Isso fica para uma decisão separada, se você quiser essa camada extra depois.

## Região Sudeste

### Espírito Santo

O nevoeiro que cobre a Serra capixaba nas madrugadas de inverno esconde o caracol do próprio
jogador, em vez de esconder o jogador do caracol como o Blooper já faz. Essa inversão é a terceira
ideia que pediria mecanismo novo; a alternativa sem abrir escopo novo é reaproveitar o Blooper como
já existe. A Pedra Azul, rocha que muda de cor ao longo do dia, é puro flavor visual, sem efeito
obrigatório, ou, se quiser uma mecânica leve, um desconto pequeno.

### Minas Gerais

A Zona de Convergência do Atlântico Sul já causou enchentes graves e reais em Minas, incluindo um
evento recente com mais de 700 milímetros de chuva em poucos dias. O evento de jogo correspondente é
raro (verão, outubro a março) e forte: dobra o custo de redirecionar para quem está no estado e
desacelera o caracol contra ele, por três a seis horas. A geada da Mantiqueira, mais frequente e mais
fraca, desacelera o caracol em apenas 20% durante o inverno.

### Rio de Janeiro

O calor carioca do verão é constante e por isso fraco: um ajuste pequeno de preço, para cima ou para
baixo, ainda por decidir. O temporal de verão, ligado à mesma Zona de Convergência que afeta Minas,
segue o padrão forte e raro: dobra o custo de redirecionar e desacelera o caracol contra quem está
no Rio, por duas a quatro horas.

Como Rio de Janeiro e São Paulo provavelmente concentram mais jogadores por serem estados grandes, a
proposta é deixar os eventos fortes mais raros ali e os fracos mais frequentes, para que o efeito
médio por pessoa fique parecido com o de estados menores.

### São Paulo

A ilha de calor urbana, com diferença real de até 12 graus entre bairros da cidade, vira um evento
quase permanente mas fraco: um pouco mais caro redirecionar, ligando e desligando em blocos de duas
a quatro horas. As "quatro estações num só dia", reputação real do clima paulistano, viram um evento
raro que sorteia um pequeno buff ou um pequeno nerf ao acionar, sem lado fixo.

## Região Sul

### Paraná

A geada do planalto, que Curitiba sente com mais força que qualquer capital brasileira, desacelera o
caracol inteiro (não só contra um alvo) em 30%, por três horas, ativa em boa parte do inverno. As
Cataratas do Iguaçu e Itaipu, os ícones turísticos e econômicos do estado, dão um desconto de metade
do preço, uma vez por semana.

### Rio Grande do Sul

O ciclone extratropical, que já passou de 100 km/h de vento e afetou mais de 140 municípios em
eventos reais, é o evento mais intenso e mais curto de toda a proposta: dobra a velocidade do
caracol e o custo de redirecionar por só trinta a quarenta e cinco minutos, raro, concentrado no
outono e inverno. O bloqueio atmosférico, fenômeno real de estagnação climática que trava a região
por dias, é o oposto: mais raro ainda, mas mais longo (seis a oito horas) e mais fraco (50% a mais
no preço, não o dobro).

### Santa Catarina

O mesmo ciclone extratropical também atinge Santa Catarina, mas com menos força que no epicentro
gaúcho, então o evento aqui acelera o caracol em 50% em vez de 100%, por vinte a trinta minutos. A
Oktoberfest de Blumenau, em outubro, propõe um bônus de moedas acionado pelo próprio jogador ao
entrar no estado durante o mês do evento. Isso pediria um tipo de evento novo, uma ação que o
jogador dispara em vez de só receber; a alternativa sem lever novo é tratar como desconto passivo o
mês inteiro, igual aos outros eventos culturais da lista.

---

## O que falta decidir

Antes de qualquer spec formal, quatro perguntas seguem em aberto:

Primeiro, os três pedidos de mecanismo novo (o ETA borrado do Ceará, a velocidade do caracol ligada
à localização do alvo em Minas e no Maranhão, e o bônus disparável da Oktoberfest) precisam de um
sim ou não. Cada um já tem uma alternativa ao lado que não exige nada além do que o jogo já faz.

Segundo, o tick de reavaliação (15 ou 30 minutos) e o teto de estados simultâneos (o intervalo
sugerido foi de 4 a 8) precisam de um número fechado.

Terceiro, dois ou três eventos ficaram como "chamada de tom" em vez de decisão fechada, como o calor
carioca, que pode virar buff ou nerf dependendo do que você preferir.

Quarto, e talvez o mais importante: os cinco pensadores juntos propuseram cerca de 50 eventos, dois
por estado em média. Isso provavelmente é mais do que cabe numa primeira versão. Escolher um
subconjunto (por exemplo, um evento por estado, priorizando os que não pedem mecanismo novo) é uma
decisão sua, não algo que eu deva cortar sozinho.
