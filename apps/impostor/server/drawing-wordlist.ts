import { normalizeText } from './normalization';

export interface DrawingWord {
  id: string;
  name: string;
  category: 'Animais' | 'Objetos';
  aliases: string[];
}

const wordSets: Record<DrawingWord['category'], string> = {
  Animais: `cachorro|gato|coelho|cavalo|vaca|porco|ovelha|cabra|galinha|galo|pato|ganso|peru|peixe|tubarão|baleia|golfinho|polvo|lula|caranguejo|tartaruga|jacaré|crocodilo|cobra|lagarto|camaleão|sapo|rã|borboleta|abelha|formiga|joaninha|aranha|escorpião|mosquito|besouro|caracol|minhoca|leão|tigre|onça|leopardo|guepardo|elefante|girafa|zebra|rinoceronte|hipopótamo|macaco|gorila|urso|panda|canguru|coala|raposa|lobo|veado|alce|esquilo|morcego|rato|hamster|ouriço|pinguim|flamingo|águia|coruja|papagaio|tucano|avestruz|pavão|cisne|pica-pau|beija-flor|carneiro|doninha|lontra|castor|foca|sardinha|salmão|carpa|estrela-do-mar|cavalo-marinho|medusa|lagosta|lagarta|grilo|gafanhoto|libélula|centopeia|vaga-lume`,
  Objetos: `cadeira|mesa|cama|sofá|abajur|relógio|óculos|guarda-chuva|mochila|mala|chapéu|sapato|tênis|camiseta|casaco|calça|vestido|gravata|bolsa|chave|cadeado|tesoura|martelo|serrote|parafuso|escova|pente|espelho|vassoura|balde|panela|frigideira|colher|garfo|faca|prato|copo|caneca|garrafa|chaleira|liquidificador|torradeira|geladeira|televisão|telefone|celular|computador|teclado|mouse|fone de ouvido|câmera|controle remoto|videogame|livro|caderno|lápis|caneta|borracha|régua|bola|bicicleta|skate|patins|violão|piano|microfone|lanterna|ventilador|aspirador|escada|vaso|flor|quadro|cortina|travesseiro|cobertor|toalha|sabonete|escova de dentes|secador|panela de pressão|saca-rolha|ímã|termômetro|binóculo|bússola|martelo|pincel|tinta|tesouro|robô|foguete|avião|barco|carrinho|pipa|balão|presente|ampulheta|coroa|varinha mágica|sino|moeda|cédula|cartão|guizo|dominó|dado|quebra-cabeça|máscara|fantoche|guarda-roupa|estante|lixeira`,
};

const aliasesByName: Record<string, string[]> = {
  cachorro: ['cão', 'cachorrinho'],
  gato: ['gatinho'],
  cavalo: ['cavalinho'],
  peixe: ['peixinho'],
  tubarao: ['tubarão branco'],
  jacare: ['jacaré'],
  rã: ['ra', 'sapo pequeno'],
  borboleta: ['borboletinha'],
  aranha: ['aranhinha'],
  elefante: ['elefantinho'],
  macaco: ['macaquinho'],
  pinguim: ['pinguim'],
  passaro: ['pássaro'],
  picapau: ['pica-pau'],
  'cavalo marinho': ['cavalo-marinho'],
  'estrela do mar': ['estrela-do-mar'],
  sofa: ['sofá'],
  oculos: ['óculos de grau'],
  'guarda chuva': ['guarda-chuva'],
  tenis: ['tênis'],
  'chave de fenda': ['chave'],
  celular: ['telefone celular', 'smartphone'],
  computador: ['pc'],
  camera: ['câmera fotográfica', 'máquina fotográfica'],
  videogame: ['video game', 'console'],
  lapis: ['lápis de escrever'],
  caneta: ['caneta esferográfica'],
  bola: ['bola de futebol'],
  bicicleta: ['bike'],
  violao: ['violão'],
  'fone de ouvido': ['fone'],
  'escova de dentes': ['escova dental'],
  'panela de pressao': ['panela de pressão'],
  sacarolha: ['saca-rolha'],
  ima: ['ímã'],
  termometro: ['termômetro'],
  binoculo: ['binóculo'],
  bussola: ['bússola'],
  foguete: ['rocket'],
  aviao: ['avião'],
  barco: ['navio'],
  carrinho: ['carro'],
  pipa: ['papagaio de papel'],
  balao: ['balão de festa'],
  'varinha magica': ['varinha mágica'],
  dado: ['dados'],
  'quebra cabeca': ['quebra-cabeça'],
  mascara: ['máscara'],
  lixeira: ['lixo'],
};

const seeds = Object.entries(wordSets).flatMap(([category, names]) =>
  names.split('|').map((name) => ({
    name,
    category: category as DrawingWord['category'],
    aliases: aliasesByName[normalizeText(name)] ?? [],
  })),
);

const uniqueSeeds = new Map<string, (typeof seeds)[number]>();
for (const seed of seeds) {
  const key = normalizeText(seed.name);
  if (key && !uniqueSeeds.has(key)) uniqueSeeds.set(key, seed);
}

export const drawingWords: DrawingWord[] = Array.from(uniqueSeeds.values()).map((seed, index) => ({
  id: `drawing-word-${String(index + 1).padStart(4, '0')}`,
  name: seed.name,
  category: seed.category,
  aliases: seed.aliases,
}));

if (drawingWords.length < 150) {
  throw new Error(`A wordlist de desenho precisa ter pelo menos 150 entradas; encontrada: ${drawingWords.length}`);
}

export function pickDrawingWord(): DrawingWord {
  return drawingWords[Math.floor(Math.random() * drawingWords.length)] ?? drawingWords[0]!;
}

export function drawingWordMatches(word: DrawingWord, guess: string): boolean {
  const normalizedGuess = normalizeText(guess);
  return [word.name, ...word.aliases].some((answer) => normalizeText(answer) === normalizedGuess);
}
