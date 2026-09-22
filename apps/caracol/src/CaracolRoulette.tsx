import { useEffect, useRef, useState, type FormEvent, type JSX, type ReactNode } from 'react';
import {
  CARACOL_ROULETTE_CATALOG,
  CARACOL_ROULETTE_COOLDOWN_MS,
  caracolRouletteItemById,
  type CaracolEffectView,
  type CaracolRouletteItemId,
  type CaracolStateView,
} from '../shared/caracol';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const RING_RADIUS = 25;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Relógio do servidor visto pelo cliente (AD-003): a defasagem é medida a cada
 * estado recebido e a contagem só anda na tela, uma vez por minuto.
 */
export function useServerNow(serverNow: number): number {
  const skewRef = useRef(0);
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    skewRef.current = serverNow - Date.now();
    setNow(serverNow);
    const timer = window.setInterval(() => setNow(Date.now() + skewRef.current), 60_000);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  return now;
}

/** Os 13 símbolos: traço de 1,8 px na grade de 24 px, no vocabulário do caracol do mapa. */
function symbolPaths(itemId: CaracolRouletteItemId): JSX.Element {
  switch (itemId) {
    case 'mushroom':
      return <><path d="M3.5 12.5a8.5 8.5 0 0 1 17 0z" /><path d="M9 12.5v5.4a3 3 0 0 0 6 0v-5.4" /><circle cx="8.8" cy="8.6" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="9.6" r="1.05" fill="currentColor" stroke="none" /></>;
    case 'star':
      return <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.7L12 17.7l-5.9 3.2 1.2-6.7L2.5 9.5l6.6-.9z" />;
    case 'fire-flower':
      return <><path d="M12 2.5c.5 3.5 4.5 5 4.5 9.5a4.5 4.5 0 0 1-9 0c0-2 .8-3.2 1.8-4.2.3 1.6 1.2 2.2 1.9 2.2.8-2-1-4.5.8-7.5z" /><path d="M12 21.6v-2.1" /></>;
    case 'boomerang':
      return <path d="M4 20C4 11 11 4 20 4c0 2.1-.4 3.7-1.1 5.1C13 9.7 9.7 13 9.1 18.9 7.7 19.6 6.1 20 4 20z" />;
    case 'bullet-bill':
      return <><path d="M8 6.5h5.4a5.5 5.5 0 0 1 0 11H8z" /><path d="M2.6 9h3.1M2.6 12h4.6M2.6 15h3.1" /><circle cx="14.2" cy="10.6" r="1.15" fill="currentColor" stroke="none" /></>;
    case 'coin':
      return <><circle cx="12" cy="12" r="8.6" /><circle cx="12" cy="12" r="4.5" /></>;
    case 'shield':
      return <><path d="M12 2.8l7.5 2.8v6.1c0 4.9-3.6 8-7.5 9.5-3.9-1.5-7.5-4.6-7.5-9.5V5.6z" /><path d="M9 11.9l2.2 2.3 4.1-4.3" /></>;
    case 'red-shell':
      return <><path d="M3 18.6a9 9 0 0 1 18 0z" /><path d="M3 18.6h18" /><path d="M8.6 18.6c0-4.1 1.5-7.3 3.4-7.3s3.4 3.2 3.4 7.3" /></>;
    case 'bomb':
      return <><circle cx="10.4" cy="14.6" r="6.8" /><path d="M15.3 9.7l2.3-2.7" /><path d="M17.6 7l1.2-2.7M17.6 7l2.9-.4M19.7 8.9L22.1 8" /></>;
    case 'lightning':
      return <path d="M13.6 2.5 5 13.8h5.4L9.8 21.5 19 10.2h-5.6z" />;
    case 'blooper':
      return <><path d="M5 11.2a7 7 0 0 1 14 0v2.1H5z" /><path d="M7.1 13.3c0 3-1 5.1-2.3 6.5M11 13.3c0 3.5-.4 5.7-1 7.4M13.4 13.3c0 3.5.4 5.7 1 7.4M17.3 13.3c0 3 1 5.1 2.3 6.5" /><circle cx="9.6" cy="9.2" r="1.25" fill="currentColor" stroke="none" /><circle cx="14.4" cy="9.2" r="1.25" fill="currentColor" stroke="none" /></>;
    case 'freeze':
      return <><path d="M12 2.6v18.8M3.9 7.3l16.2 9.4M20.1 7.3 3.9 16.7" /><path d="M12 6.4 9.7 4.2M12 6.4l2.3-2.2M12 17.6l-2.3 2.2M12 17.6l2.3 2.2" /></>;
    case 'banana':
      return <path d="M4.6 4.6c0 8.7 6.1 14.8 14.8 14.8-.8 1.4-2.4 2.1-4.4 2.1C7.8 21.5 2.5 16.2 2.5 8.9c0-2 .7-3.6 2.1-4.3z" />;
  }
}

export function RouletteSymbol({ itemId, size = 24, strokeWidth = 1.8 }: { itemId: CaracolRouletteItemId; size?: number; strokeWidth?: number }): JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{symbolPaths(itemId)}</svg>;
}

function ClockIcon(): JSX.Element {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6" /><path d="M12 7.4V12l3.1 2" /></svg>;
}

/** "7h 20min" para o título do cartão. Arredonda para cima: nunca mostra "0min" antes de abrir. */
export function formatWait(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}min`;
  return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
}

/** "1h12" ou "41min" para os chips de efeito. */
function formatChipTime(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h${String(minutes).padStart(2, '0')}` : `${minutes}min`;
}

function effectRemaining(effect: CaracolEffectView, now: number): string {
  if (effect.charges !== null && effect.itemId !== 'fire-flower') return `${effect.charges} uso${effect.charges === 1 ? '' : 's'}`;
  const time = formatChipTime(effect.expiresAt - now);
  return effect.charges !== null ? `${effect.charges}× · ${time}` : time;
}

function EffectChip({ effect, now, world = false }: { effect: CaracolEffectView; now: number; world?: boolean }): JSX.Element {
  const item = caracolRouletteItemById.get(effect.itemId)!;
  return <span className={`caracol-effect-chip is-${item.category}`} title={item.summary}>
    <RouletteSymbol itemId={effect.itemId} size={16} strokeWidth={2.1} />
    <b>{item.shortName}{world ? ' no mapa' : ''} {effectRemaining(effect, now)}</b>
  </span>;
}

export function PlayerEffects({ itemIds }: { itemIds: CaracolRouletteItemId[] }): JSX.Element | null {
  if (itemIds.length === 0) return null;
  const names = itemIds.map((itemId) => caracolRouletteItemById.get(itemId)!.name).join(', ');
  return <span className="caracol-player-effects" role="img" aria-label={`efeitos: ${names}`} title={names}>
    {itemIds.map((itemId) => <i className={`caracol-player-effect is-${caracolRouletteItemById.get(itemId)!.category}`} key={itemId}><RouletteSymbol itemId={itemId} size={12} strokeWidth={2.2} /></i>)}
  </span>;
}

function WaitRing({ availableAt, now }: { availableAt: number; now: number }): JSX.Element {
  const remaining = Math.min(1, Math.max(0, (availableAt - now) / CARACOL_ROULETTE_COOLDOWN_MS));
  return <svg className="caracol-roulette-ring" width="62" height="62" viewBox="0 0 62 62" aria-hidden="true">
    <circle cx="31" cy="31" r={RING_RADIUS} fill="none" stroke="rgba(21,21,37,0.15)" strokeWidth="3" />
    <circle cx="31" cy="31" r={RING_RADIUS} fill="none" stroke="var(--coral)" strokeWidth="3" strokeLinecap="round" strokeDasharray={RING_LENGTH.toFixed(1)} strokeDashoffset={(RING_LENGTH * remaining).toFixed(1)} transform="rotate(-90 31 31)" />
  </svg>;
}

interface RouletteCardProps {
  state: CaracolStateView;
  online: boolean;
  spinning: boolean;
  onSpin: () => void;
  onBoomerang: (targetNickname: string) => void;
  /** Espaço para a troca de cidade do Cogumelo, que usa o seletor do jogo. */
  children?: ReactNode;
}

export function RouletteCard({ state, online, spinning, onSpin, onBoomerang, children }: RouletteCardProps): JSX.Element {
  const now = useServerNow(state.world.serverNow);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [boomerangNickname, setBoomerangNickname] = useState('');
  const { roulette, effects } = state.you;
  const blocked = state.needsCity;
  const waiting = !blocked && roulette.availableAt !== null && roulette.availableAt > now;
  const freeze = effects.find((effect) => effect.itemId === 'freeze' && effect.expiresAt > now) ?? null;
  const boomerang = effects.find((effect) => effect.itemId === 'boomerang' && effect.expiresAt > now) ?? null;
  const activeEffects = effects.filter((effect) => effect.expiresAt > now);
  const worldEffects = state.world.effects.filter((effect) => effect.expiresAt > now);
  const lastItem = roulette.lastItemId ? caracolRouletteItemById.get(roulette.lastItemId) ?? null : null;

  function throwBoomerang(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const targetNickname = boomerangNickname.trim();
    if (!targetNickname) return;
    onBoomerang(targetNickname);
    setBoomerangNickname('');
  }

  return <section className="caracol-roulette-card paper-card" aria-labelledby="caracol-roulette-title">
    <div className="panel-heading">
      <div><span className="micro-label">{waiting ? 'Volta em' : 'Uma vez por dia'}</span><h2 id="caracol-roulette-title">{waiting ? formatWait(roulette.availableAt! - now) : 'A roleta'}</h2></div>
      {waiting ? <WaitRing availableAt={roulette.availableAt!} now={now} /> : <RouletteSymbol itemId="star" size={30} strokeWidth={1.7} />}
    </div>

    {blocked ? <>
      <div className="caracol-roulette-locked"><b>Escolha sua cidade primeiro</b><p>A roleta abre quando você entra no mapa. Quem está morto não gira.</p></div>
      <button className="caracol-roulette-spin" type="button" disabled>Girar a roleta<span>BLOQUEADO</span></button>
    </> : !waiting ? <>
      <p className="caracol-roulette-lede">Metade dos itens ajuda, metade atrapalha. Você não escolhe e não dá para devolver.</p>
      <button className="caracol-roulette-spin" type="button" onClick={onSpin} disabled={!online || spinning}>{spinning ? 'Girando…' : 'Girar a roleta'}<span>1 GIRO</span></button>
    </> : null}

    {freeze && <div className="caracol-roulette-frozen" role="status">
      <span className="caracol-roulette-frozen-mark"><RouletteSymbol itemId="freeze" size={22} strokeWidth={2} /></span>
      <div><b>Você está congelado</b><p>Nada de comprar, acelerar, redirecionar ou lançar bumerangue por {formatWait(freeze.expiresAt - now)}. As moedas continuam entrando.</p></div>
    </div>}
    {freeze && <p className="caracol-roulette-note">Não dá para tirar o debuff. Só esperar.</p>}

    {(activeEffects.length > 0 || worldEffects.length > 0) && <div className="caracol-roulette-section">
      <span className="micro-label">Valendo agora</span>
      <div className="caracol-effect-list">
        {activeEffects.map((effect) => <EffectChip effect={effect} now={now} key={effect.itemId} />)}
        {worldEffects.map((effect) => <EffectChip effect={effect} now={now} world key={`world-${effect.itemId}`} />)}
      </div>
    </div>}

    {boomerang && !blocked && <form className="caracol-roulette-boomerang" onSubmit={throwBoomerang}>
      <label className="field-label" htmlFor="caracol-boomerang-target">Lançar o Bumerangue<input id="caracol-boomerang-target" className="text-input" value={boomerangNickname} onChange={(event) => setBoomerangNickname(event.target.value)} placeholder="nick de alguém vivo" autoComplete="off" /></label>
      <button className="ghost-button caracol-action-button" type="submit" disabled={!online || Boolean(freeze)}>Roubar 20% dessa pessoa <span>1 uso</span></button>
    </form>}

    {children}

    <div className="caracol-roulette-last">
      <div><span className="micro-label">Último giro</span><b>{lastItem ? lastItem.name : 'Nenhum ainda'}</b></div>
      <button className="caracol-roulette-catalog-toggle" type="button" onClick={() => setCatalogOpen((open) => !open)} aria-expanded={catalogOpen} aria-controls="caracol-roulette-catalog">{catalogOpen ? 'Fechar' : 'Ver os 13'}</button>
    </div>
    {catalogOpen && <ul id="caracol-roulette-catalog" className="caracol-roulette-catalog">
      {CARACOL_ROULETTE_CATALOG.map((item) => <li key={item.id}>
        <span className={`caracol-roulette-catalog-mark is-${item.category}`}><RouletteSymbol itemId={item.id} size={18} /></span>
        <div><b>{item.name}</b><p>{item.summary}</p></div>
        <small>{item.durationLabel}</small>
      </li>)}
    </ul>}
  </section>;
}

export function RouletteReveal({ itemId, state, onClose }: { itemId: CaracolRouletteItemId; state: CaracolStateView; onClose: () => void }): JSX.Element {
  const item = caracolRouletteItemById.get(itemId)!;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // A data e a cidade são as do momento do giro, não as do próximo estado.
  const [date] = useState(() => new Date(state.world.serverNow));
  const [detail] = useState(() => itemId === 'bullet-bill' && state.you.city ? ` Nova casa: ${state.you.city.name} · ${state.you.city.uf}.` : '');

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return <div className="caracol-reveal" role="dialog" aria-modal="true" aria-labelledby="caracol-reveal-title">
    <article className={`caracol-reveal-card is-${item.category}`}>
      <div className="caracol-reveal-head"><span>{date.getDate()} {MONTHS[date.getMonth()]} · seu giro de hoje</span><b>{item.category === 'buff' ? 'BUFF' : 'DEBUFF'}</b></div>
      <div className="caracol-reveal-body">
        <span className={`caracol-reveal-symbol is-${item.category}`}><RouletteSymbol itemId={itemId} size={72} strokeWidth={1.5} /></span>
        <h2 id="caracol-reveal-title">{item.name}</h2>
        <p>{item.description}{detail}</p>
        <div className="caracol-reveal-duration"><ClockIcon /><span>{item.durationLabel}</span></div>
      </div>
    </article>
    <button ref={closeRef} className="caracol-reveal-close" type="button" onClick={onClose}>Entendi</button>
  </div>;
}
