import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore, Village } from './village.mjs';
import { createVillageServer } from './http.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production';
const inviteCode = process.env.INVITE_CODE ?? (production ? '' : 'vila-local-amigos');
const publicOrigin = process.env.PUBLIC_ORIGIN ?? (production ? '' : 'http://127.0.0.1:5176');
if (production && (!publicOrigin.startsWith('https://') || inviteCode.length < 16)) throw Error('Configure PUBLIC_ORIGIN HTTPS e INVITE_CODE de pelo menos 16 caracteres');
const store = await JsonStore.open(resolve(process.env.DATA_FILE ?? resolve(appRoot, 'data', 'village.json')));
const village = new Village(store, { inviteCode });
const server = createVillageServer(village, { publicOrigin, dist: resolve(appRoot, 'dist') });
server.listen(Number(process.env.PORT ?? 3340), process.env.HOST ?? '127.0.0.1', () => console.log('Vila dos Agentes: serviço iniciado'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(); setTimeout(() => process.exit(0), 5000).unref(); });
