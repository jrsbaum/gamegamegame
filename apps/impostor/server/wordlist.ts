import { normalizeText } from './normalization';
import { characterImages, type CharacterImage } from './character-images';

export interface Character {
  id: string;
  name: string;
  category: string;
  aliases: string[];
  image?: CharacterImage;
}

interface CharacterSeed {
  name: string;
  category: string;
  aliases?: string[];
}

// Núcleo popular: personagens e nomes que a maioria das pessoas reconhece.
const characterSets: Record<string, string> = {
  Marvel: `Homem-Aranha|Homem de Ferro|Capitão América|Thor|Hulk|Viúva Negra|Pantera Negra|Doutor Estranho|Capitã Marvel|Feiticeira Escarlate|Homem-Formiga|Loki|Thanos|Deadpool|Wolverine|Venom|Demolidor|Nick Fury|Duende Verde|Miles Morales`,
  DC: `Superman|Batman|Mulher-Maravilha|Aquaman|Flash|Lanterna Verde|Supergirl|Robin|Ciborgue|Shazam|Coringa|Arlequina|Mulher-Gato|Hera Venenosa|Lex Luthor|Bane|Ravena|Darkseid`,
  'Disney e Pixar': `Mickey Mouse|Minnie Mouse|Pato Donald|Pateta|Simba|Mufasa|Scar|Ariel|Úrsula|Bela|Fera|Aladdin|Jasmine|Gênio|Mulan|Moana|Elsa|Anna|Olaf|Stitch|Peter Pan|Cinderela|Malévola|Woody|Buzz Lightyear|Relâmpago McQueen|Remy|WALL-E|Alegria|Miguel Rivera`,
  Animação: `Pernalonga|Tom|Jerry|Scooby-Doo|Salsicha|Homer Simpson|Bart Simpson|Lisa Simpson|Peter Griffin|Stewie Griffin|Rick Sanchez|Morty Smith|Aang|Zuko|Bob Esponja|Patrick Estrela|Finn, o Humano|Jake, o Cão|Pica-Pau|Gato de Botas`,
  'Anime e mangá': `Goku|Vegeta|Gohan|Piccolo|Naruto Uzumaki|Sasuke Uchiha|Kakashi Hatake|Luffy|Roronoa Zoro|Nami|Sanji|Eren Yeager|Mikasa Ackerman|Levi Ackerman|Light Yagami|L|Tanjiro Kamado|Nezuko Kamado|Satoru Gojo|Sailor Moon|Ash Ketchum|Pikachu|Totoro`,
  Videogames: `Mario|Luigi|Princesa Peach|Bowser|Yoshi|Link|Zelda|Kirby|Donkey Kong|Sonic|Tails|Knuckles|Dr. Eggman|Mega Man|Ryu|Chun-Li|Lara Croft|Kratos|Master Chief|Solid Snake|Pac-Man|Steve (Minecraft)`,
  'Fantasia e ficção científica': `Frodo Bolseiro|Gandalf|Gollum|Sauron|Harry Potter|Hermione Granger|Ron Weasley|Alvo Dumbledore|Severo Snape|Draco Malfoy|Voldemort|Katniss Everdeen|Luke Skywalker|Leia Organa|Han Solo|Chewbacca|Darth Vader|Yoda|Obi-Wan Kenobi|R2-D2|C-3PO|Rey|Neo|Trinity|Godzilla`,
  Cinema: `Forrest Gump|Indiana Jones|James Bond|Ethan Hunt|John Wick|Rocky Balboa|Rambo|Marty McFly|Doc Brown|Jack Sparrow|Willy Wonka|Mary Poppins|Grinch|Kevin McCallister|Elle Woods|Vito Corleone|Michael Corleone|Tony Montana|Jules Winnfield|Beatrix Kiddo|Maximus|William Wallace|Shrek|Gru|Jack Skellington`,
  Séries: `Walter White|Jesse Pinkman|Saul Goodman|Sherlock Holmes|John Watson|Michael Scott|Dwight Schrute|Jim Halpert|Rachel Green|Ross Geller|Monica Geller|Chandler Bing|Joey Tribbiani|Dexter Morgan|Daenerys Targaryen|Jon Snow|Arya Stark|Tyrion Lannister|Onze|Thomas Shelby|O Doutor`,
  'Ficção brasileira': `Emília|Narizinho|Dona Benta|Saci-Pererê|Mônica|Cebolinha|Cascão|Magali|Chico Bento|Chaves|Chapolin Colorado|Seu Madruga|Chiquinha|Kiko|Dona Florinda|Carminha|Odete Roitman|Nazaré Tedesco|João Grilo|Chicó`,
  Música: `Michael Jackson|Elvis Presley|Madonna|Beyoncé|Rihanna|Lady Gaga|Taylor Swift|Britney Spears|Bruno Mars|Adele|Amy Winehouse|Bob Marley|John Lennon|Paul McCartney|Freddie Mercury|David Bowie|Elton John|Whitney Houston|Anitta|Roberto Carlos`,
  Esportes: `Pelé|Marta|Neymar|Ronaldo Nazário|Ronaldinho Gaúcho|Romário|Ayrton Senna|Rebeca Andrade|Michael Jordan|LeBron James|Kobe Bryant|Serena Williams|Simone Biles|Usain Bolt|Muhammad Ali|Mike Tyson|Rafael Nadal|Cristiano Ronaldo|Lionel Messi|Diego Maradona`,
  'História, ciência e cultura': `Albert Einstein|Marie Curie|Isaac Newton|Leonardo da Vinci|Mahatma Gandhi|Nelson Mandela|Martin Luther King Jr.|Abraham Lincoln|Napoleão Bonaparte|Cleópatra|Steve Jobs|Bill Gates|Elon Musk|Oprah Winfrey|Walt Disney|Stan Lee|George Lucas|Steven Spielberg|Frida Kahlo|Vincent van Gogh`,
  'Literatura e mitologia': `Alice|Chapeleiro Louco|Tom Sawyer|Jay Gatsby|Atticus Finch|Dom Quixote|Sancho Pança|Dorian Gray|Oliver Twist|Ebenezer Scrooge|Jane Eyre|Elizabeth Bennet|Sr. Darcy|Frankenstein|Drácula|Aslan|Matilda Wormwood|Zeus|Hades|Medusa`,
};

const aliasesByName: Record<string, string[]> = {
  'homem aranha': ['Spiderman', 'Peter Parker'],
  'homem de ferro': ['Tony Stark'],
  'capitao america': ['Steve Rogers'],
  hulk: ['Bruce Banner'],
  'pantera negra': ['TChalla', "T'Challa"],
  'doutor estranho': ['Stephen Strange'],
  'capita marvel': ['Carol Danvers'],
  'feiticeira escarlate': ['Wanda Maximoff'],
  'homem formiga': ['Scott Lang'],
  deadpool: ['Wade Wilson'],
  wolverine: ['Logan'],
  superman: ['Clark Kent', 'Super-Homem'],
  supergirl: ['Kara Zor-El', 'Super-Moça'],
  batman: ['Bruce Wayne'],
  'mulher maravilha': ['Diana Prince'],
  flash: ['Barry Allen'],
  'mulher gato': ['Selina Kyle'],
  arlequina: ['Harleen Quinzel'],
  'mickey mouse': ['Mickey'],
  'bob esponja': ['SpongeBob'],
  tom: ['Tom Cat'],
  jerry: ['Jerry Mouse'],
  salsicha: ['Shaggy'],
  'patrick estrela': ['Patrick'],
  goku: ['Son Goku', 'Kakarotto'],
  'naruto uzumaki': ['Naruto'],
  luffy: ['Monkey D. Luffy'],
  'sailor moon': ['Usagi Tsukino'],
  'ash ketchum': ['Ash'],
  mario: ['Super Mario'],
  zelda: ['Princess Zelda'],
  'dr eggman': ['Eggman'],
  'steve minecraft': ['Steve'],
  'harry potter': ['Harry'],
  'darth vader': ['Anakin Skywalker'],
  'r2 d2': ['R2D2'],
  'c 3 po': ['C3PO'],
  'james bond': ['007'],
  'marty mcfly': ['Marty'],
  'doc brown': ['Emmett Brown', 'Doc'],
  'jack sparrow': ['Captain Jack Sparrow'],
  'kevin mccallister': ['Kevin'],
  'walter white': ['Heisenberg'],
  'sherlock holmes': ['Sherlock'],
  'o doutor': ['Doctor Who'],
  'chaves': ['El Chavo'],
  'chapolin colorado': ['Chapolin'],
  kiko: ['Quico'],
  pele: ['Edson Arantes do Nascimento', 'Edson'],
  marta: ['Marta Vieira da Silva'],
  neymar: ['Neymar Jr', 'Neymar Junior'],
  'ronaldo nazario': ['Ronaldo'],
  'ronaldinho gaucho': ['Ronaldinho'],
  'ayrton senna': ['Senna'],
  'cristiano ronaldo': ['CR7'],
  'lionel messi': ['Messi'],
  'michael jackson': ['MJ'],
  'freddie mercury': ['Freddie'],
  anitta: ['Larissa de Macedo'],
  'albert einstein': ['Einstein'],
  'marie curie': ['Maria Sklodowska Curie'],
  'mahatma gandhi': ['Gandhi'],
  'martin luther king jr': ['MLK', 'Martin Luther King'],
  'steve jobs': ['Steve'],
  'walt disney': ['Disney'],
  'stan lee': ['Stanley Lieber'],
  'vincent van gogh': ['Van Gogh'],
  'chapeleiro louco': ['Chapeleiro Maluco'],
  dracula: ['Count Dracula'],
};

// Nome PT-BR normalizado (normalizeText) -> nome original em inglês.
// Registra só os pares em que a forma brasileira difere do original: um nome
// que já é o mesmo em português e inglês (ex.: Batman, Goku) não entra aqui,
// senão o teste do WORD-06 acusaria "inglês exibido" num nome correto.
export const englishOriginals: Record<string, string> = {
  'homem aranha': 'Spider-Man',
  'homem de ferro': 'Iron Man',
  'capitao america': 'Captain America',
  'viuva negra': 'Black Widow',
  'pantera negra': 'Black Panther',
  'doutor estranho': 'Doctor Strange',
  'capita marvel': 'Captain Marvel',
  'feiticeira escarlate': 'Scarlet Witch',
  'homem formiga': 'Ant-Man',
  demolidor: 'Daredevil',
  'duende verde': 'Green Goblin',
  'mulher maravilha': 'Wonder Woman',
  'lanterna verde': 'Green Lantern',
  ciborgue: 'Cyborg',
  coringa: 'Joker',
  arlequina: 'Harley Quinn',
  'mulher gato': 'Catwoman',
  'hera venenosa': 'Poison Ivy',
  ravena: 'Raven',
  'pato donald': 'Donald Duck',
  pateta: 'Goofy',
  bela: 'Belle',
  fera: 'Beast',
  genio: 'Genie',
  cinderela: 'Cinderella',
  malevola: 'Maleficent',
  'relampago mcqueen': 'Lightning McQueen',
  alegria: 'Joy',
  pernalonga: 'Bugs Bunny',
  'salsicha': 'Shaggy Rogers',
  'bob esponja': 'SpongeBob SquarePants',
  'patrick estrela': 'Patrick Star',
  'finn o humano': 'Finn the Human',
  'jake o cao': 'Jake the Dog',
  'pica pau': 'Woody Woodpecker',
  'gato de botas': 'Puss in Boots',
  'princesa peach': 'Princess Peach',
  sonic: 'Sonic the Hedgehog',
  'frodo bolseiro': 'Frodo Baggins',
  'alvo dumbledore': 'Albus Dumbledore',
  'severo snape': 'Severus Snape',
  grinch: 'The Grinch',
  onze: 'Eleven',
  'o doutor': 'The Doctor',
  // Diferença real de grafia (não é só acento: "ão" vs "on"), então
  // normalizeText não faria o palpite em inglês bater sem este par.
  'napoleao bonaparte': 'Napoleon Bonaparte',
  'chapeleiro louco': 'Mad Hatter',
  'dom quixote': 'Don Quixote',
  'sancho panca': 'Sancho Panza',
  'sr darcy': 'Mr Darcy',
};

function mergeAliases(name: string): string[] {
  const key = normalizeText(name);
  const baseAliases = aliasesByName[key] ?? [];
  const original = englishOriginals[key];
  if (!original || baseAliases.some((alias) => normalizeText(alias) === normalizeText(original))) {
    return baseAliases;
  }
  return [...baseAliases, original];
}

const seeds: CharacterSeed[] = Object.entries(characterSets).flatMap(([category, names]) =>
  names.split('|').map((name) => ({
    name,
    category,
    aliases: mergeAliases(name),
  })),
);

// Exportado só para o teste de guarda contra colisão silenciosa de tradução:
// se uniqueSeeds descartar uma entrada, characters.length < totalSeedCount.
export const totalSeedCount = seeds.length;

const uniqueSeeds = new Map<string, CharacterSeed>();
for (const seed of seeds) {
  const key = normalizeText(seed.name);
  if (key && !uniqueSeeds.has(key)) {
    uniqueSeeds.set(key, seed);
  }
}

export const characters: Character[] = Array.from(uniqueSeeds.values()).map((seed, index) => {
  const image = characterImages[normalizeText(seed.name)];
  return {
    id: `character-${String(index + 1).padStart(4, '0')}`,
    name: seed.name,
    category: seed.category,
    aliases: seed.aliases ?? [],
    ...(image ? { image } : {}),
  };
});

const MIN_CURATED_CHARACTERS = 250;
if (characters.length < MIN_CURATED_CHARACTERS) {
  throw new Error(
    `O catálogo popular precisa ter pelo menos ${MIN_CURATED_CHARACTERS} entradas; encontrada: ${characters.length}`,
  );
}

export function pickCharacters(amount: number, excludeIds?: ReadonlySet<string>): Character[] {
  const pool = excludeIds ? characters.filter((character) => !excludeIds.has(character.id)) : [...characters];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = pool[index];
    pool[index] = pool[swapIndex]!;
    pool[swapIndex] = current!;
  }
  return pool.slice(0, amount);
}

export function characterMatches(character: Character, guess: string): boolean {
  const normalizedGuess = normalizeText(guess);
  return [character.name, ...character.aliases].some((answer) => normalizeText(answer) === normalizedGuess);
}
