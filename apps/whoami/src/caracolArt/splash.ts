import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { emptyCaracolOutfit } from '../../shared/caracol';
import { CaracolFigure } from '../CaracolAvatar';
import { CARACOL_ART_PALETTE as C } from './model';

// A splash do PWA (public/icons/caracol-splash.svg) sai do mesmo desenho do jogo.
// É estática, então o caracol aparece sem peças: o visual global muda durante o jogo.

const MEDALLION = { cx: 585, cy: 1186, r: 280 };

/**
 * renderToStaticMarkup numera os ids de useId do zero a cada chamada, então a
 * saída é estável e o teste de deriva compara o arquivo com esta string.
 */
export function renderCaracolSplash(): string {
  const { cx, cy, r } = MEDALLION;
  const snail = renderToStaticMarkup(createElement(CaracolFigure, {
    wearer: 'snail',
    outfit: emptyCaracolOutfit(),
    crop: 'portrait',
    sizePx: r * 2,
    x: cx - r,
    y: cy - r,
    width: r * 2,
    height: r * 2,
  }));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1170 2532">',
    '  <!-- Gerado por scripts/render-caracol-splash.ts (npm run splash:caracol). Não edite à mão. -->',
    `  <rect width="1170" height="2532" fill="${C.ink}"/>`,
    `  <defs><clipPath id="caracol-splash-medallion"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>`,
    `  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.white}"/>`,
    `  <g clip-path="url(#caracol-splash-medallion)">${snail}</g>`,
    `  <text x="585" y="1610" fill="${C.paper}" font-family="Arial, sans-serif" font-size="58" font-weight="700" text-anchor="middle">CARACOL</text>`,
    '</svg>',
    '',
  ].join('\n');
}
