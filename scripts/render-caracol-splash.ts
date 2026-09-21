// Regrava public/icons/caracol-splash.svg a partir da arte do jogo.
// Uso: npm run splash:caracol. O tsconfig.app.json é o que ensina o tsx a compilar o JSX dos componentes.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderCaracolSplash } from '../src/caracolArt/splash';

const target = join(__dirname, '..', 'public', 'icons', 'caracol-splash.svg');
writeFileSync(target, renderCaracolSplash());
console.log(`splash gravada em ${target}`);
