import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CaracolGame.tsx abre o socket no import, então o que sobra nele é conferido
// lendo o fonte. Estes guardas falham se o desenho antigo voltar.

const SRC = new URL('../src/', import.meta.url);
const STYLES = readFileSync(new URL('styles.css', SRC), 'utf8');

/** As declarações da regra com exatamente este seletor. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(STYLES);
  if (!match) throw new Error(`regra ${selector} não encontrada`);
  return match[1]!;
}

function componentSources(): { file: string; text: string }[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => ({ file, text: readFileSync(new URL(file, SRC), 'utf8') }));
}

describe('guarda do novo design', () => {
  it('não sobra CosmeticAvatar nem cosmetic-avatar nos componentes (ARTE-14)', () => {
    const sources = componentSources();
    expect(sources.map((source) => source.file)).toContain('CaracolGame.tsx');
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/CosmeticAvatar|cosmetic-avatar/);
    }
  });

  it('não sobra CSS do avatar de caixas (ARTE-14)', () => {
    expect(STYLES).toContain('.caracol-medallion');
    expect(STYLES).not.toContain('.cosmetic-');
  });

  it('não sobra desenho antigo de token do mapa', () => {
    for (const { file, text } of componentSources()) {
      expect(text, file).not.toMatch(/mapPlayerAvatar|mapDeadAvatar|mapSnailAvatar/);
    }
  });

  it('não sobra CSS dos glifos antigos do mapa e da lista (LISTA-03, MAPA-05)', () => {
    for (const selector of ['.map-avatar-', '.map-snail-', '.map-dead-avatar', '.caracol-skull', '.legend-skull']) {
      expect(STYLES, selector).not.toContain(selector);
    }
  });

  it('não pinta todo <circle> dos tokens, que repintaria olhos, lentes e mostradores', () => {
    expect(STYLES).not.toMatch(/\.(map-player|snail-token)[^{}]*\bcircle\s*[{,]/);
    for (const tone of ['you', 'target', 'dead']) expect(STYLES).toContain(`.map-medallion-ring.tone-${tone}`);
  });

  it('recorta o medalhão em círculo com fundo #fffdf8 (ARTE-08)', () => {
    const medallion = rule('.caracol-medallion');
    expect(medallion).toContain('border-radius: 50%');
    expect(medallion).toContain('overflow: hidden');
    expect(medallion).toContain('background: #fffdf8');
  });

  it('põe em cinza só o retrato de quem morreu; sem saldo continua em cor (LISTA-03)', () => {
    const dead = rule('.caracol-medallion.tone-dead');
    expect(dead).toContain('filter: grayscale(1)');
    expect(dead).toContain('opacity: 0.55');
    for (const tone of ['default', 'you', 'target', 'equipped', 'unaffordable']) {
      const other = STYLES.match(new RegExp(`\\.caracol-medallion\\.tone-${tone} \\{[^}]*\\}`, 'g')) ?? [];
      for (const declarations of other) expect(declarations, tone).not.toMatch(/grayscale|opacity/);
    }
    expect(STYLES.match(/grayscale/g)).toHaveLength(1);
  });

  it('pinta o anel do mapa de céu, ácido para você, coral para o alvo e cinza para quem morreu (MAPA-01, MAPA-03)', () => {
    expect(rule('.map-medallion-ring')).toContain('stroke: var(--sky)');
    expect(rule('.map-medallion-ring.tone-you')).toContain('stroke: var(--acid)');
    expect(rule('.map-medallion-ring.tone-target')).toContain('stroke: var(--coral)');
    expect(rule('.map-medallion-ring.tone-dead')).toContain('stroke: #8b8498');
  });

  it('usa o medalhão no bolso, no cartão do caracol, na legenda e na lista da tela do jogo (ARTE-14)', () => {
    const game = readFileSync(new URL('CaracolGame.tsx', SRC), 'utf8');
    expect(game).toMatch(/className="caracol-wallet paper-card"><CaracolMedallion wearer="player" outfit=\{state\.shop\.player\.outfit\} size=\{64\}/);
    expect(game).toMatch(/O bicho<\/span>.*<CaracolMedallion wearer="snail" outfit=\{state\.world\.snail\.outfit\} size=\{72\}/);
    expect(game).toContain('<CaracolMapLegend snailOutfit={state.world.snail.outfit} />');
    expect(game).toContain('<CaracolPlayersCard players={state.players} targetAccountId={state.world.snail.targetAccountId} />');
  });

  it('não deixa outra regra da folha desfazer o círculo, o cinza ou a cor do anel (ARTE-08, LISTA-03, MAPA-01)', () => {
    // As regras acima fixam as declarações principais; esta pega a cascata, como
    // uma regra mais específica dentro de uma media query que tire o círculo.
    const canonical = new Set(['.caracol-medallion', '.caracol-medallion.tone-dead', '.map-medallion-ring', '.map-medallion-ring.tone-you', '.map-medallion-ring.tone-target', '.map-medallion-ring.tone-dead']);
    const css = STYLES.replace(/\/\*[\s\S]*?\*\//g, '');
    let seen = 0;
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors!.split(',').map((part) => part.trim().replace(/\s+/g, ' '))) {
        if (canonical.has(selector)) {
          seen += 1;
          continue;
        }
        // O elemento conta, não a grafia: `span.caracol-medallion` e `.is-dead .tone-dead`
        // chegam ao mesmo medalhão. As classes `.tone-*` só existem no medalhão e no anel.
        const target = selector.split(/[\s>+~]+/).pop()!;
        const tone = /\.tone-[\w-]+/.test(target);
        if (tone || /\.caracol-medallion(?![\w-])/.test(target)) expect(body, selector).not.toMatch(/border-radius|overflow|background|filter|opacity/);
        if (tone || /\.map-medallion-ring(?![\w-])/.test(target)) expect(body, selector).not.toMatch(/stroke\s*:/);
      }
    }
    expect(seen).toBe(canonical.size);
  });
});
