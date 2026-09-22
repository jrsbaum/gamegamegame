import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderCaracolSplash } from '../src/caracolArt/splash';

// A splash do PWA é um SVG estático gerado a partir do mesmo desenho do jogo.

describe('splash do PWA', () => {
  const splash = renderCaracolSplash();

  it('mantém as dimensões da splash atual (SPL-04)', () => {
    expect(splash).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1170 2532">/);
  });

  it('tem fundo night, o caracol sem peças num medalhão e a palavra CARACOL (SPL-01)', () => {
    expect(splash).toContain('<rect width="1170" height="2532" fill="#151525"/>');
    expect(Array.from(splash.matchAll(/data-layer="([^"]+)"/g), (match) => match[1])).toEqual(['body', 'stalks', 'head']);
    expect(splash).toMatch(/<circle cx="585" cy="1186" r="280" fill="#fffdf8"\/>/);
    expect(splash).toMatch(/<text [^>]*font-family="Arial, sans-serif" font-size="58" font-weight="700"[^>]*>CARACOL<\/text>/);
  });

  it('escreve CARACOL abaixo do medalhão, que termina em y = 1466', () => {
    const [, cy, r] = /<circle cx="585" cy="(\d+)" r="(\d+)" fill="#fffdf8"\/>/.exec(splash)!;
    expect(Number(cy) + Number(r)).toBe(1466);
    expect(splash).toMatch(/<text x="585" y="1610"/);
  });

  it('não depende de nada fora do próprio arquivo (SPL-02)', () => {
    expect(splash).not.toMatch(/href/i);
    expect(splash).not.toContain('@import');
    for (const [, ref] of splash.matchAll(/url\(([^)]*)\)/g)) expect(ref).toMatch(/^#/);
  });

  it('gera o mesmo texto a cada chamada', () => {
    expect(renderCaracolSplash()).toBe(splash);
  });

  it('está igual ao arquivo publicado; rode npm run splash:caracol se o desenho mudou (SPL-03)', () => {
    expect(readFileSync(new URL('../public/icons/caracol-splash.svg', import.meta.url), 'utf8')).toBe(splash);
  });
});
