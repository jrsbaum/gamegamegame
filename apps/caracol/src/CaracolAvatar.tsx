import { memo, useId, useMemo, type CSSProperties, type JSX } from 'react';
import type { CaracolCosmeticWearer, CaracolOutfit } from '../shared/caracol';
import {
  CARACOL_ART_PALETTE as C,
  CARACOL_INK_MIN_PX,
  caracolArtLayers,
  caracolArtViewBox,
  sameCaracolOutfit,
  type CaracolArtCrop,
  type CaracolMedallionTone,
  type CaracolPlayerTone,
} from './caracolArt/model';
import { PLAYER_ART, type CaracolArtIds } from './caracolArt/PlayerArt';
import { SNAIL_ART } from './caracolArt/SnailArt';

// Um desenho por personagem, recortado por viewBox. CaracolFigure é o único
// lugar que desenha; medalhão, tokens do mapa e splash só escolhem recorte e tamanho.

export interface CaracolFigureProps {
  wearer: CaracolCosmeticWearer;
  outfit: CaracolOutfit;
  crop: CaracolArtCrop;
  /** Tamanho em que a figura aparece na tela; decide se a tinta tremida vale o custo. */
  sizePx: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/**
 * O servidor transmite o estado inteiro a cada segundo, com outfits em objetos
 * novos. Comparar por valor mantém o SVG de 40 a 120 nós fora do tick.
 */
export function sameFigureProps(prev: CaracolFigureProps, next: CaracolFigureProps): boolean {
  return prev.wearer === next.wearer
    && prev.crop === next.crop
    && prev.sizePx === next.sizePx
    && prev.x === next.x
    && prev.y === next.y
    && prev.width === next.width
    && prev.height === next.height
    && sameCaracolOutfit(prev.outfit, next.outfit);
}

export const CaracolFigure = memo(function CaracolFigure({ wearer, outfit, crop, sizePx, x, y, width, height }: CaracolFigureProps): JSX.Element {
  const uid = useId();
  const ids = useMemo<CaracolArtIds>(() => ({ clip: (part) => `${uid}clip-${part}`, ink: `${uid}ink` }), [uid]);
  const ink = sizePx >= CARACOL_INK_MIN_PX;
  const drawings = wearer === 'player'
    ? caracolArtLayers('player', outfit).map((layer) => PLAYER_ART[layer](ids))
    : caracolArtLayers('snail', outfit).map((layer) => SNAIL_ART[layer](ids));
  return <svg className="caracol-figure" viewBox={caracolArtViewBox(wearer, crop)} x={x} y={y} width={width} height={height} aria-hidden="true">
    {ink && <filter id={ids.ink} x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={3} />
      <feDisplacementMap in="SourceGraphic" scale={1.7} />
    </filter>}
    <g filter={ink ? `url(#${ids.ink})` : undefined}>{drawings}</g>
  </svg>;
}, sameFigureProps);

export interface CaracolMedallionProps {
  wearer: CaracolCosmeticWearer;
  outfit: CaracolOutfit;
  crop?: CaracolArtCrop;
  size: number;
  tone?: CaracolMedallionTone;
  label: string;
}

/**
 * O retrato circular usado no HTML. O tamanho entra por --medallion-size para a
 * media query conseguir sobrescrever, e o selo fica fora do círculo, que corta o
 * que passa da borda. O anel nunca é o único portador do estado: cada tom tem um
 * texto na mesma tela que diz a mesma coisa.
 */
export function CaracolMedallion({ wearer, outfit, crop = 'portrait', size, tone = 'default', label }: CaracolMedallionProps): JSX.Element {
  return <span className="caracol-avatar" role="img" aria-label={label} style={{ '--medallion-size': `${size}px` } as CSSProperties}>
    <span className={`caracol-medallion tone-${tone}`}><CaracolFigure wearer={wearer} outfit={outfit} crop={crop} sizePx={size} /></span>
    {tone === 'equipped' && <span className="caracol-avatar-badge badge-check"><CheckBadge /></span>}
    {tone === 'dead' && <span className="caracol-avatar-badge badge-skull"><SkullBadge /></span>}
  </span>;
}

/**
 * O retrato de um jogador dentro do SVG do mapa. A cor do anel vem de
 * `.map-medallion-ring.tone-*`; no celular o token vira um ponto de 6 a 8 px,
 * e é a cor do anel que carrega o estado. O cinza do morto é filtro SVG, que
 * dentro do mapa funciona igual em todo navegador.
 */
export function CaracolMapPlayer({ outfit, x, y, radius, tone }: { outfit: CaracolOutfit; x: number; y: number; radius: number; tone: CaracolPlayerTone }): JSX.Element {
  const uid = useId();
  const dead = tone === 'dead';
  return <g transform={`translate(${x} ${y})`}>
    <defs>
      <clipPath id={`${uid}clip`}><circle r={radius} /></clipPath>
      {dead && <filter id={`${uid}gray`}><feColorMatrix type="saturate" values="0" /></filter>}
    </defs>
    <g filter={dead ? `url(#${uid}gray)` : undefined}>
      <circle r={radius} fill={C.white} />
      <g clipPath={`url(#${uid}clip)`}>
        <CaracolFigure wearer="player" outfit={outfit} crop="portrait" sizePx={radius * 2} x={-radius} y={-radius} width={radius * 2} height={radius * 2} />
      </g>
    </g>
    <circle r={radius} className={`map-medallion-ring tone-${tone}`} fill="none" strokeWidth={2.5} strokeDasharray={dead ? '2 2' : undefined} />
  </g>;
}

/** O caracol de corpo inteiro no mapa: a concha é a silhueta que se reconhece de longe. */
export function CaracolMapSnail({ outfit, x, y }: { outfit: CaracolOutfit; x: number; y: number }): JSX.Element {
  return <CaracolFigure wearer="snail" outfit={outfit} crop="full" sizePx={40} x={x - 20} y={y - 38} width={40} height={40} />;
}

function CheckBadge(): JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true">
    <circle cx={10} cy={10} r={8.5} fill={C.acid} stroke={C.ink} strokeWidth={2} />
    <path d="M6 10.5 L8.8 13.2 L14 7.4" fill="none" stroke={C.ink} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function SkullBadge(): JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true">
    <circle cx={10} cy={10} r={8.5} fill={C.paper} stroke={C.ink} strokeWidth={2} />
    <path d="M5.5 10.5 V8.6 A4.5 4.5 0 0 1 14.5 8.6 V10.5 L13 13.6 H7 Z" fill="#bcb5c7" stroke={C.ink} strokeWidth={1.4} strokeLinejoin="round" />
    <circle cx={8.2} cy={9.2} r={1.1} fill={C.ink} />
    <circle cx={11.8} cy={9.2} r={1.1} fill={C.ink} />
    <path d="M8.4 12 H11.6" fill="none" stroke={C.ink} strokeWidth={1.1} strokeLinecap="round" />
  </svg>;
}
