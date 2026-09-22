import { CARACOL_ART_PALETTE as C, type SnailArtLayer } from './model';
import { artLayers, flower, INK, INK_THIN, leaf, line } from './PlayerArt';

// O caracol no traço Waldo, em coordenadas fixas de 240 × 240. Ele não tem pulso
// nem rosto humano: o relógio fica preso na antena, os óculos na ponta dos olhos
// e o boné entre as antenas. Geometria portada de plano/new-design/estudo/arte.mjs.

function spiral(cx: number, cy: number, r0: number, turns: number): string {
  const points: string[] = [];
  const steps = 90;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2 - Math.PI / 2;
    const radius = r0 * (1 - t) + 4;
    points.push(`${(cx + Math.cos(angle) * radius).toFixed(1)} ${(cy + Math.sin(angle) * radius).toFixed(1)}`);
  }
  return 'M' + points.join(' L');
}

const N = {
  column: 'M60 206 C54 170 60 142 72 124 L118 124 C128 142 132 172 128 206 Z',
  shirt: 'M60 194 C57 166 62 144 71 128 L119 128 C128 146 131 168 129 194 Z',
  foot: 'M16 214 C18 198 56 192 96 194 L200 198 C218 198 234 206 232 216 Z',
  pants: 'M56 184 L132 184 L136 214 L102 214 L95 202 L88 214 L52 214 Z',
  capCrown: 'M68 80 C66 54 124 54 122 80 Z',
};

const SHELL_SPIRAL = spiral(162, 122, 52, 2.6);
const WATCH_TILT = 'rotate(-18 76 56)';

export const SNAIL_ART = artLayers<SnailArtLayer>({
  body: () => <>
    <ellipse cx={124} cy={218} rx={112} ry={7} fill={C.ink} opacity={0.12} />
    <circle cx={162} cy={122} r={62} fill={C.shell} {...INK} />
    {line(SHELL_SPIRAL, 3)}
    <path d={N.foot} fill={C.snailBody} {...INK} />
    <path d={N.column} fill={C.snailBody} {...INK} />
  </>,
  stalks: () => <>
    <path d="M80 78 L66 34 L76 31 L90 76 Z" fill={C.snailBody} {...INK} />
    <path d="M104 76 L114 31 L124 34 L112 78 Z" fill={C.snailBody} {...INK} />
  </>,
  head: () => <>
    <circle cx={70} cy={27} r={11} fill={C.white} {...INK} />
    <circle cx={120} cy={27} r={11} fill={C.white} {...INK} />
    <circle cx={73} cy={29} r={4} fill={C.ink} />
    <circle cx={117} cy={29} r={4} fill={C.ink} />
    <ellipse cx={95} cy={100} rx={38} ry={31} fill={C.snailBody} {...INK} />
    {line('M78 106 Q95 121 112 106', 2.8)}
    <circle cx={72} cy={98} r={4} fill={C.coral} opacity={0.55} />
    <circle cx={118} cy={98} r={4} fill={C.coral} opacity={0.55} />
  </>,

  'pants-jeans': () => <>
    <path d={N.pants} fill={C.jeans} {...INK} />
    {line('M95 186 L95 200', 2)}
    {line('M62 192 Q72 194 76 185 M126 192 Q116 194 112 185', 1.8)}
  </>,
  'pants-cargo': () => <>
    <path d={N.pants} fill={C.olive} {...INK} />
    <rect x={58} y={192} width={18} height={16} rx={2} fill={C.oliveDark} {...INK_THIN} />
    <rect x={114} y={192} width={18} height={16} rx={2} fill={C.oliveDark} {...INK_THIN} />
  </>,
  'pants-neon-race': () => <>
    <path d={N.pants} fill={C.acid} {...INK} />
    <path d="M58 186 L65 186 L61 212 L54 212 Z M123 186 L130 186 L134 212 L127 212 Z" fill={C.ink} />
  </>,

  'shirt-basic': () => <>
    <path d={N.shirt} fill={C.basic} />
    <path d={N.shirt} fill="none" {...INK} />
    {line('M80 130 Q95 142 110 130', 2.4)}
  </>,
  'shirt-striped': (ids) => <>
    <defs><clipPath id={ids.clip('snail-shirt')}><path d={N.shirt} /></clipPath></defs>
    <path d={N.shirt} fill={C.paper} />
    <g clipPath={`url(#${ids.clip('snail-shirt')})`}>
      {Array.from({ length: 6 }, (_, i) => <rect key={i} x={40} y={130 + i * 14} width={110} height={7} fill={C.coral} />)}
    </g>
    <path d={N.shirt} fill="none" {...INK} />
  </>,
  'shirt-tropical': (ids) => <>
    <defs><clipPath id={ids.clip('snail-shirt')}><path d={N.shirt} /></clipPath></defs>
    <path d={N.shirt} fill={C.tropical} />
    <g clipPath={`url(#${ids.clip('snail-shirt')})`}>
      {leaf(76, 150, 30)}{leaf(114, 170, -25)}{leaf(82, 184, 70)}{flower(106, 146)}{flower(72, 170)}
    </g>
    <path d={N.shirt} fill="none" {...INK} />
    <path d="M80 128 L95 146 L78 142 Z" fill={C.tropical} {...INK_THIN} />
    <path d="M110 128 L95 146 L112 142 Z" fill={C.tropical} {...INK_THIN} />
  </>,

  'watch-digital': () => <>
    <rect x={67} y={52} width={19} height={8} rx={3} fill={C.sky} transform={WATCH_TILT} {...INK_THIN} />
    <rect x={70} y={49} width={13} height={13} rx={3} fill={C.ink} transform={WATCH_TILT} {...INK_THIN} />
    <path d="M73 54 h3 M73 58 h3 M78 54 h2 M78 58 h2" stroke={C.acid} strokeWidth={1.6} strokeLinecap="round" transform={WATCH_TILT} />
  </>,
  'watch-gold': () => <>
    <rect x={67} y={52} width={19} height={8} rx={3} fill={C.gold} transform={WATCH_TILT} {...INK_THIN} />
    <circle cx={76.5} cy={56} r={7} fill={C.paper} stroke={C.goldDark} strokeWidth={2.6} />
    {line('M76.5 56 L76.5 51.5 M76.5 56 L79.5 57.5', 1.5)}
  </>,
  'watch-holographic': () => <g transform={WATCH_TILT}>
    <rect x={67} y={52} width={19} height={8} rx={3} fill={C.lavender} {...INK_THIN} />
    <rect x={69} y={48} width={15} height={15} rx={4} fill={C.lavender} {...INK_THIN} />
    <path d="M71 55 h11 v5 h-11 Z" fill={C.sky} />
    <path d="M71 50.5 h11 v4.5 h-11 Z" fill={C.acid} />
    <rect x={69} y={48} width={15} height={15} rx={4} fill="none" {...INK_THIN} />
  </g>,

  'glasses-round': () => <>
    <circle cx={70} cy={27} r={14} fill={C.white} fillOpacity={0.35} stroke={C.ink} strokeWidth={4} />
    <circle cx={120} cy={27} r={14} fill={C.white} fillOpacity={0.35} stroke={C.ink} strokeWidth={4} />
    {line('M84 26 Q95 20 106 26', 3.4)}
  </>,
  'glasses-dark': () => <>
    <path d="M54 18 L86 18 L84 34 Q70 42 57 34 Z" fill={C.ink} {...INK} />
    <path d="M104 18 L136 18 L133 34 Q120 42 106 34 Z" fill={C.ink} {...INK} />
    {line('M86 21 L104 21', 3.4)}
    {line('M60 23 L67 23 M110 23 L117 23', 1.8, C.paper)}
  </>,
  'glasses-neon-visor': () => <>
    <path d="M52 18 Q95 10 138 18 L136 36 Q95 42 54 36 Z" fill={C.sky} {...INK} />
    <circle cx={73} cy={29} r={4} fill={C.ink} opacity={0.55} />
    <circle cx={117} cy={29} r={4} fill={C.ink} opacity={0.55} />
    {line('M58 21.5 Q95 14.5 132 21.5', 2.4, C.acid)}
  </>,

  'cap-flat': () => <>
    <path d={N.capCrown} fill={C.coral} {...INK} />
    <path d="M58 78 L136 74 L137 83 L58 86 Z" fill={C.coral} {...INK} />
    <circle cx={95} cy={67} r={5} fill={C.acid} {...INK_THIN} />
  </>,
  'cap-trucker': () => <>
    <path d={N.capCrown} fill={C.sky} {...INK} />
    <path d="M80 80 C79 60 111 60 110 80 Z" fill={C.white} {...INK_THIN} />
    <path d="M62 78 Q95 88 128 78 L130 85 Q95 98 60 85 Z" fill={C.sky} {...INK} />
    {line('M88 70 L102 70', 2.4, C.coral)}
  </>,
  'cap-bucket': () => <>
    <path d="M72 78 C72 52 118 52 118 78 Z" fill={C.olive} {...INK} />
    <path d="M72 76 L118 76 L136 92 Q95 84 54 92 Z" fill={C.olive} {...INK} />
    {line('M64 86 Q95 79 126 86', 1.6, C.paper)}
  </>,
});
