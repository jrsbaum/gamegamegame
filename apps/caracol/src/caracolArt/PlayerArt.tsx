import { Fragment, type JSX, type ReactNode } from 'react';
import { CARACOL_ART_PALETTE as C, type PlayerArtLayer } from './model';

// O jogador no traço Waldo, em coordenadas fixas de 200 × 400. Geometria e cores
// portadas sem mudança de plano/new-design/estudo/arte.mjs.

/** Ids únicos da instância, para `clipPath` e filtro não colidirem entre avatares da mesma página. */
export interface CaracolArtIds {
  clip: (part: string) => string;
  ink: string;
}

export type CaracolArtDrawing = (ids: CaracolArtIds) => JSX.Element;

export const INK = { stroke: C.ink, strokeWidth: 3.2, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;
export const INK_THIN = { stroke: C.ink, strokeWidth: 2.2, strokeLinejoin: 'round', strokeLinecap: 'round' } as const;

export function line(d: string, width = 2.4, color: string = C.ink): JSX.Element {
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />;
}

export function leaf(x: number, y: number, rotation: number, scale = 1): JSX.Element {
  return <g transform={`translate(${x} ${y}) rotate(${rotation}) scale(${scale})`}>
    <path d="M0 -9 C6 -4 6 4 0 9 C-6 4 -6 -4 0 -9 Z" fill={C.acid} {...INK_THIN} />
    {line('M0 -7 L0 7', 1.6)}
  </g>;
}

export function flower(x: number, y: number): JSX.Element {
  return <g transform={`translate(${x} ${y})`}>
    <circle r={5.5} fill={C.coral} {...INK_THIN} />
    <circle r={1.8} fill={C.acid} />
  </g>;
}

/** Cada camada vira um `<g data-layer>`, que os testes e a depuração usam sem depender da geometria. */
export function artLayers<K extends string>(drawings: Record<K, (ids: CaracolArtIds) => ReactNode>): Record<K, CaracolArtDrawing> {
  const entries = Object.entries(drawings) as [K, (ids: CaracolArtIds) => ReactNode][];
  return Object.fromEntries(entries.map(([key, draw]) => [key, (ids: CaracolArtIds) => <g key={key} data-layer={key}>{draw(ids)}</g>])) as Record<K, CaracolArtDrawing>;
}

const P = {
  torso: 'M64 156 C62 136 74 126 90 124 Q100 136 110 124 C126 126 138 136 136 156 L140 238 L60 238 Z',
  sleeveL: 'M72 130 C58 136 50 150 47 168 L63 172 C64 160 67 152 72 148 Z',
  sleeveR: 'M128 130 C140 126 152 122 165 124 L167 141 C155 141 145 146 136 152 Z',
  pants: 'M60 234 L140 234 L138 356 L106 356 L100 272 L94 356 L62 356 Z',
};

type ShirtPart = 'L' | 'R' | 'T';
const SHIRT_PARTS: readonly (readonly [ShirtPart, string])[] = [['L', P.sleeveL], ['R', P.sleeveR], ['T', P.torso]];

// Cada parte pinta, estampa e contorna antes da próxima: o tronco cobre a costura interna das mangas.
function shirt(fill: string, ids: CaracolArtIds, pattern?: (part: ShirtPart) => ReactNode): JSX.Element {
  const clip = (part: ShirtPart): string => ids.clip(`shirt-${part}`);
  return <>
    {pattern && <defs>{SHIRT_PARTS.map(([part, d]) => <clipPath key={part} id={clip(part)}><path d={d} /></clipPath>)}</defs>}
    {SHIRT_PARTS.map(([part, d]) => <Fragment key={part}>
      <path d={d} fill={fill} />
      {pattern && <g clipPath={`url(#${clip(part)})`}>{pattern(part)}</g>}
      <path d={d} fill="none" {...INK} />
    </Fragment>)}
  </>;
}

function stripes(y0: number, y1: number, step: number, color: string): JSX.Element[] {
  const rects: JSX.Element[] = [];
  for (let y = y0; y < y1; y += step * 2) rects.push(<rect key={y} x={20} y={y} width={170} height={step} fill={color} />);
  return rects;
}

const WRIST_BAND = { x: 147, y: 100, width: 21, height: 10, rx: 3 } as const;
const CAP_CROWN = 'M68 64 C66 32 134 32 132 64 Z';

export const PLAYER_ART = artLayers<PlayerArtLayer>({
  legs: () => <>
    <ellipse cx={78} cy={362} rx={20} ry={8.5} fill={C.ink} {...INK} />
    <ellipse cx={122} cy={362} rx={20} ry={8.5} fill={C.ink} {...INK} />
  </>,
  'pants-default': () => <path d={P.pants} fill={C.jeans} {...INK} />,
  // Braço esquerdo solto, braço direito erguido acenando: o relógio fica no pulso levantado, dentro do retrato.
  arms: () => <>
    <path d="M48 166 L63 170 L59 214 L44 212 Z" fill={C.skin} {...INK} />
    <circle cx={51} cy={220} r={9.5} fill={C.skin} {...INK} />
    <path d="M150 136 L166 134 L165 100 L150 100 Z" fill={C.skin} {...INK} />
    <ellipse cx={146} cy={95} rx={4.5} ry={7} transform="rotate(-35 146 95)" fill={C.skin} {...INK} />
    <ellipse cx={157.5} cy={86} rx={10.5} ry={12.5} fill={C.skin} {...INK} />
    {line('M152 75 L152 81 M157.5 73 L157.5 80 M163 75 L163 81', 2)}
    <rect x={91} y={104} width={18} height={34} fill={C.skin} {...INK} />
  </>,
  'shirt-default': (ids) => shirt(C.sky, ids),
  head: () => <>
    <path d="M68 90 C58 62 70 36 98 34 C124 32 142 48 136 74 L140 88 L131 80 L130 94 L124 78 L76 78 L71 94 L68 82 Z" fill={C.hair} {...INK} />
    <circle cx={70} cy={88} r={8.5} fill={C.skin} {...INK} />
    <circle cx={130} cy={88} r={8.5} fill={C.skin} {...INK} />
    <ellipse cx={100} cy={84} rx={30} ry={34} fill={C.skin} {...INK} />
  </>,
  fringe: () => <path d="M69 76 C72 52 126 46 133 70 L126 64 L122 74 L114 60 L107 72 L99 58 L92 72 L85 60 L80 73 L74 64 Z" fill={C.hair} {...INK} />,
  eyes: () => <>
    <circle cx={89} cy={86} r={3.2} fill={C.ink} />
    <circle cx={111} cy={86} r={3.2} fill={C.ink} />
  </>,
  mouth: () => <>
    {line('M100 89 q6 5 0 9', 2.2)}
    {line('M85 104 Q100 117 115 104', 2.6)}
  </>,

  'pants-jeans': () => <>
    <path d={P.pants} fill={C.jeans} {...INK} />
    <path d="M63 340 L97 340 L96 356 L62 356 Z M103 340 L138 340 L138 356 L106 356 Z" fill={C.jeansLight} {...INK_THIN} />
    {line('M100 238 L100 262', 2)}
    {line('M66 250 Q78 252 82 238 M134 250 Q122 252 118 238', 2)}
    {line('M70 262 L68 336 M130 262 L132 336', 1.6, C.sky)}
  </>,
  'pants-cargo': () => <>
    <path d={P.pants} fill={C.olive} {...INK} />
    <rect x={60} y={276} width={22} height={26} rx={2} fill={C.oliveDark} {...INK_THIN} />
    <path d="M59 276 L83 276 L83 284 L59 284 Z" fill={C.olive} {...INK_THIN} />
    <rect x={118} y={276} width={22} height={26} rx={2} fill={C.oliveDark} {...INK_THIN} />
    <path d="M117 276 L141 276 L141 284 L117 284 Z" fill={C.olive} {...INK_THIN} />
    {line('M100 238 L100 262', 2)}
  </>,
  'pants-neon-race': () => <>
    <path d={P.pants} fill={C.acid} {...INK} />
    <path d="M61 238 L69 238 L70 356 L62 356 Z M131 238 L139 238 L138 356 L130 356 Z" fill={C.ink} />
    <path d="M63 318 L97 318 L96.5 326 L62.5 326 Z M103.5 318 L138 318 L138 326 L104 326 Z" fill={C.sky} {...INK_THIN} />
    <path d={P.pants} fill="none" {...INK} />
  </>,

  'shirt-basic': (ids) => <>
    {shirt(C.basic, ids)}
    {line('M92 127 Q100 140 108 127', 2.4)}
    <rect x={113} y={150} width={14} height={14} rx={2} fill="none" {...INK_THIN} />
  </>,
  'shirt-striped': (ids) => shirt(C.paper, ids, () => stripes(118, 240, 7, C.coral)),
  'shirt-tropical': (ids) => <>
    {shirt(C.tropical, ids, (part) => part === 'T'
      ? <>{leaf(76, 170, 30)}{leaf(122, 190, -25)}{leaf(84, 214, 70)}{flower(118, 158)}{flower(74, 196)}{flower(126, 222)}</>
      : part === 'R' ? leaf(148, 132, 80, 0.8) : leaf(58, 152, -20, 0.8))}
    <path d="M90 124 L100 146 L86 140 Z" fill={C.tropical} {...INK_THIN} />
    <path d="M110 124 L100 146 L114 140 Z" fill={C.tropical} {...INK_THIN} />
    <circle cx={100} cy={162} r={2.2} fill={C.paper} {...INK_THIN} />
    <circle cx={100} cy={184} r={2.2} fill={C.paper} {...INK_THIN} />
    <circle cx={100} cy={206} r={2.2} fill={C.paper} {...INK_THIN} />
  </>,

  'watch-digital': () => <>
    <rect {...WRIST_BAND} fill={C.sky} {...INK_THIN} />
    <rect x={150} y={96.5} width={15} height={16} rx={3} fill={C.ink} {...INK_THIN} />
    <path d="M153 102 h3 M153 106 h3 M159 102 h3 M159 106 h3" stroke={C.acid} strokeWidth={1.8} strokeLinecap="round" />
  </>,
  'watch-gold': () => <>
    <rect {...WRIST_BAND} fill={C.gold} {...INK_THIN} />
    <circle cx={157.5} cy={105} r={8} fill={C.paper} stroke={C.goldDark} strokeWidth={3} />
    {line('M157.5 105 L157.5 100 M157.5 105 L161 107', 1.6)}
  </>,
  'watch-holographic': () => <>
    <rect {...WRIST_BAND} fill={C.lavender} {...INK_THIN} />
    <rect x={149} y={96} width={17} height={17} rx={4} fill={C.lavender} {...INK_THIN} />
    <path d="M151 104 h13 v5 h-13 Z" fill={C.sky} />
    <path d="M151 99 h13 v5 h-13 Z" fill={C.acid} />
    <rect x={149} y={96} width={17} height={17} rx={4} fill="none" {...INK_THIN} />
    {line('M170 94 l3 -3 M171 100 l4 0', 1.6)}
  </>,

  'glasses-round': () => <>
    {line('M79 84 L70 82 M121 84 L130 82', 2.6)}
    <circle cx={88} cy={86} r={10.5} fill={C.white} stroke={C.ink} strokeWidth={3.8} />
    <circle cx={112} cy={86} r={10.5} fill={C.white} stroke={C.ink} strokeWidth={3.8} />
    {line('M98 84 Q100 80 102 84', 3)}
    <circle cx={89} cy={87} r={3.2} fill={C.ink} />
    <circle cx={111} cy={87} r={3.2} fill={C.ink} />
  </>,
  'glasses-dark': () => <>
    {line('M77 82 L69 80 M123 82 L131 80', 2.6)}
    <path d="M76 79 L98 79 L96 92 Q87 97 78 91 Z" fill={C.ink} {...INK} />
    <path d="M102 79 L124 79 L122 91 Q113 97 104 92 Z" fill={C.ink} {...INK} />
    {line('M98 81 L102 81', 3)}
    {line('M81 83 L86 83 M107 83 L112 83', 1.8, C.paper)}
  </>,
  'glasses-neon-visor': () => <>
    {line('M72 84 L66 82 M128 84 L134 82', 2.6)}
    <path d="M72 78 Q100 72 128 78 L126 93 Q100 98 74 93 Z" fill={C.sky} {...INK} />
    <circle cx={89} cy={86} r={3} fill={C.ink} opacity={0.55} />
    <circle cx={111} cy={86} r={3} fill={C.ink} opacity={0.55} />
    {line('M77 80.5 Q100 75.5 123 80.5', 2.4, C.acid)}
  </>,

  'cap-flat': () => <>
    <path d={CAP_CROWN} fill={C.coral} {...INK} />
    <path d="M60 62 L146 58 L147 68 L60 70 Z" fill={C.coral} {...INK} />
    <circle cx={100} cy={36} r={3.5} fill={C.coral} {...INK_THIN} />
    <circle cx={100} cy={50} r={6} fill={C.acid} {...INK_THIN} />
  </>,
  'cap-trucker': () => <>
    <path d={CAP_CROWN} fill={C.sky} {...INK} />
    <circle cx={74} cy={56} r={1.4} fill={C.ink} />
    <circle cx={78} cy={48} r={1.4} fill={C.ink} />
    <circle cx={126} cy={56} r={1.4} fill={C.ink} />
    <circle cx={122} cy={48} r={1.4} fill={C.ink} />
    <circle cx={72} cy={62} r={1.4} fill={C.ink} />
    <circle cx={128} cy={62} r={1.4} fill={C.ink} />
    <path d="M82 64 C80 38 120 38 118 64 Z" fill={C.white} {...INK_THIN} />
    <path d="M64 62 Q100 74 136 62 L138 69 Q100 84 62 69 Z" fill={C.sky} {...INK} />
    <circle cx={100} cy={35} r={3} fill={C.sky} {...INK_THIN} />
    {line('M92 53 L108 53', 2.6, C.coral)}
  </>,
  'cap-bucket': () => <>
    <path d="M72 60 C72 32 128 32 128 60 Z" fill={C.olive} {...INK} />
    <path d="M72 58 L128 58 L148 78 Q100 68 52 78 Z" fill={C.olive} {...INK} />
    {line('M66 70 Q100 62 134 70', 1.6, C.paper)}
  </>,
});
