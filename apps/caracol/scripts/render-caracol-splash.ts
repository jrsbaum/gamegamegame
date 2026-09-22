import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderCaracolSplash } from '../src/caracolArt/splash';

const target = join(__dirname, '..', 'public', 'icons', 'caracol-splash.svg');
writeFileSync(target, renderCaracolSplash());
console.log(`splash gravada em ${target}`);
