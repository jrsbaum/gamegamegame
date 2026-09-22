import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react';
import type {
  CaracolActionResult,
  CaracolCosmeticSlot,
  CaracolCosmeticWearer,
  CaracolHistoryEntry,
  CaracolLoginInput,
  CaracolRegisterInput,
  CaracolRouletteItemId,
  CaracolStateView,
} from '../shared/caracol';
import { CARACOL_BRAZILIA, CARACOL_HISTORY_PAGE_SIZE } from '../shared/caracol';
import { brazilianCities, type BrazilianCity } from '../shared/cities';
import { RouletteCard, RouletteReveal } from './CaracolRoulette';
import { caracolSocket } from './caracolSocket';
import { CaracolMedallion } from './CaracolAvatar';
import { BrazilMap, CaracolMapLegend, type GeoFeatureCollection } from './CaracolMap';
import { CaracolPlayersCard } from './CaracolPlayers';
import { CaracolShopDrawer } from './CaracolShop';
import { serverMayHibernate, wakeServer } from './socket';

type AuthMode = 'login' | 'register';
type ConnectionState = 'offline' | 'connecting' | 'waking' | 'online' | 'reconnecting';
type Feedback = { tone: 'neutral' | 'success' | 'error'; message: string } | null;
type ShopTab = CaracolCosmeticWearer;

interface CaracolGameProps {
  onExit: () => void;
}

const MAX_PASSWORD_LENGTH = 72;
const CARACOL_SESSION_KEY = 'caracol:session-token';
const ROULETTE_ACK_TIMEOUT_MS = 10_000;

export function CaracolGame({ onExit }: CaracolGameProps): JSX.Element {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<CaracolStateView | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('offline');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<CaracolRegisterInput | CaracolLoginInput | null>(null);
  const [cityQuery, setCityQuery] = useState('');
  const [redirectNickname, setRedirectNickname] = useState('');
  const [pushStatus, setPushStatus] = useState<'idle' | 'working' | 'enabled' | 'denied' | 'unavailable'>('idle');
  const [restoringSession, setRestoringSession] = useState(() => Boolean(readCaracolSessionToken()));
  const [standaloneMode, setStandaloneMode] = useState(() => isStandaloneMode());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<ShopTab>('player');
  const [historyEntries, setHistoryEntries] = useState<CaracolHistoryEntry[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [revealItemId, setRevealItemId] = useState<CaracolRouletteItemId | null>(null);
  const iosDevice = useMemo(() => isIosDevice(), []);
  const [geoJson, setGeoJson] = useState<GeoFeatureCollection | null>(null);

  const pendingAuthRef = useRef<CaracolRegisterInput | CaracolLoginInput | null>(null);
  const authModeRef = useRef<AuthMode>(authMode);
  const restoreAttemptRef = useRef(false);
  const hiddenSinceRef = useRef<number | null>(null);
  pendingAuthRef.current = pendingAuth;
  authModeRef.current = authMode;

  function handleAuthResult(result: CaracolActionResult): void {
    if (!result.ok) {
      const wasRestoring = restoreAttemptRef.current;
      restoreAttemptRef.current = false;
      if (wasRestoring) {
        clearCaracolSessionToken();
        setRestoringSession(false);
        setState(null);
        setConnection('offline');
        setError('Sua sessão do Caracol expirou. Entre novamente com seu nick e sua senha.');
        caracolSocket.disconnect();
        return;
      }
      setError(result.message);
      setPendingAuth(null);
      return;
    }
    restoreAttemptRef.current = false;
    if ('sessionToken' in result) saveCaracolSessionToken(result.sessionToken);
    setState(result.state);
    setLastSyncedAt(Date.now());
    setRestoringSession(false);
    setPendingAuth(null);
    setPassword('');
    setError(null);
    setFeedback({ tone: 'success', message: 'Você entrou no mapa global.' });
  }

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Caracol · Jogos';
    const onConnect = (): void => {
      setConnection('online');
      const sessionToken = readCaracolSessionToken();
      if (sessionToken) {
        restoreAttemptRef.current = true;
        setRestoringSession(true);
        caracolSocket.emit('caracol:resume', { sessionToken }, handleAuthResult);
        return;
      }
      const request = pendingAuthRef.current;
      if (!request) return;
      if (authModeRef.current === 'register') {
        caracolSocket.emit('caracol:register', request as CaracolRegisterInput, handleAuthResult);
      } else {
        caracolSocket.emit('caracol:login', request as CaracolLoginInput, handleAuthResult);
      }
    };
    const onDisconnect = (): void => setConnection(readCaracolSessionToken() || pendingAuthRef.current ? 'reconnecting' : 'offline');
    const onConnectError = (): void => {
      const hasSessionToRestore = Boolean(readCaracolSessionToken() || pendingAuthRef.current);
      setConnection(hasSessionToRestore ? (serverMayHibernate ? 'waking' : 'reconnecting') : 'offline');
      if (!hasSessionToRestore) setError('Não consegui conectar ao Caracol agora. Tente novamente em alguns segundos.');
    };
    const onState = (nextState: CaracolStateView): void => {
      setState(nextState);
      setConnection('online');
      setLastSyncedAt(Date.now());
      setRestoringSession(false);
      setPendingAuth(null);
      setError(null);
    };
    const onNotice = (payload: { message: string; code: string }): void => {
      setNotice(payload.message);
      // O giro de outra pessoa é notícia do mapa, não resposta a uma ação sua:
      // fica no aviso de cima e no histórico, sem apagar o que o painel dizia.
      if (payload.code === 'roulette') return;
      if (payload.code === 'death') setFeedback({ tone: 'error', message: payload.message });
      else setFeedback({ tone: 'neutral', message: payload.message });
    };
    const onDeath = (payload: { message: string }): void => {
      setFeedback({ tone: 'error', message: payload.message });
    };
    const onHistoryAdded = (entry: CaracolHistoryEntry): void => {
      setHistoryEntries((current) => current.some((item) => item.id === entry.id) ? current : [entry, ...current]);
    };

    caracolSocket.on('connect', onConnect);
    caracolSocket.on('disconnect', onDisconnect);
    caracolSocket.on('connect_error', onConnectError);
    caracolSocket.on('caracol:state', onState);
    caracolSocket.on('caracol:notice', onNotice);
    caracolSocket.on('caracol:death', onDeath);
    caracolSocket.on('caracol:history-added', onHistoryAdded);

    void fetch('/brazil-states.geojson', { cache: 'force-cache' })
      .then((response) => (response.ok ? response.json() as Promise<GeoFeatureCollection> : null))
      .then((data) => { if (data) setGeoJson(data); })
      .catch(() => setGeoJson(null));

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw-caracol.js', { scope: '/' }).catch(() => undefined);
    }

    const savedSession = readCaracolSessionToken();
    let cancelled = false;
    if (savedSession) {
      setRestoringSession(true);
      setConnection(serverMayHibernate ? 'waking' : 'reconnecting');
      void wakeServer().then(() => {
        if (!cancelled && !caracolSocket.connected) caracolSocket.connect();
      });
    }

    return () => {
      cancelled = true;
      document.title = previousTitle;
      caracolSocket.off('connect', onConnect);
      caracolSocket.off('disconnect', onDisconnect);
      caracolSocket.off('connect_error', onConnectError);
      caracolSocket.off('caracol:state', onState);
      caracolSocket.off('caracol:notice', onNotice);
      caracolSocket.off('caracol:death', onDeath);
      caracolSocket.off('caracol:history-added', onHistoryAdded);
      caracolSocket.disconnect();
    };

  }, []);

  useEffect(() => {
    if (!state) return;
    const syncNow = (forceReconnect = false): void => {
      if (!caracolSocket.connected) {
        setConnection('reconnecting');
        caracolSocket.connect();
        return;
      }
      if (forceReconnect) {
        setConnection('reconnecting');
        caracolSocket.disconnect();
        caracolSocket.connect();
        return;
      }
      caracolSocket.emit('caracol:visibility', { visible: document.visibilityState === 'visible' });
      if (document.visibilityState !== 'visible') return;
      caracolSocket.emit('caracol:sync', (result) => {
        if (!result.ok) {
          if (result.code === 'NOT_AUTHENTICATED' || result.code === 'SESSION_EXPIRED') {
            clearCaracolSessionToken();
            setState(null);
            setRestoringSession(false);
            setConnection('offline');
            setError('Sua sessão do Caracol expirou. Entre novamente com seu nick e sua senha.');
            caracolSocket.disconnect();
            return;
          }
          setFeedback({ tone: 'error', message: result.message });
          return;
        }
        setState(result.state);
        setLastSyncedAt(Date.now());
        setConnection('online');
      });
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
        if (caracolSocket.connected) caracolSocket.emit('caracol:visibility', { visible: false });
        return;
      }
      const hiddenFor = hiddenSinceRef.current === null ? 0 : Date.now() - hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      syncNow(hiddenFor >= 3_000);
    };
    const onPageShow = (): void => syncNow(true);
    const onFocus = (): void => syncNow(hiddenSinceRef.current !== null);
    const onOnline = (): void => syncNow(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    syncNow();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [Boolean(state)]);

  useEffect(() => {
    const updateStandalone = (): void => setStandaloneMode(isStandaloneMode());
    window.addEventListener('pageshow', updateStandalone);
    window.addEventListener('resize', updateStandalone);
    return () => {
      window.removeEventListener('pageshow', updateStandalone);
      window.removeEventListener('resize', updateStandalone);
    };
  }, []);

  useEffect(() => {
    if (!historyOpen && !shopOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (shopOpen) closeShop();
      else closeHistory();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [historyOpen, shopOpen]);

  useEffect(() => {
    const accountId = state?.you.accountId;
    if (!accountId || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    let active = true;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        const permission = 'Notification' in window ? Notification.permission : 'default';
        if (active) setPushStatus(subscription ? 'enabled' : permission === 'denied' ? 'denied' : 'idle');
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [state?.you.accountId]);

  const citySuggestions = useMemo(() => {
    const query = normalizeForSearch(cityQuery);
    if (query.length < 2) return [];
    return brazilianCities.filter((city) => normalizeForSearch(`${city.name} ${city.uf}`).includes(query)).slice(0, 16);
  }, [cityQuery]);

  function submitAuth(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const cleanNickname = nickname.trim().replace(/\s+/g, ' ');
    if (cleanNickname.length < 2 || cleanNickname.length > 24) {
      setError('Use um nick entre 2 e 24 caracteres.');
      return;
    }
    if (password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
      setError('Use uma senha entre 8 e 72 caracteres.');
      return;
    }
    setError(null);
    const request = { nickname: cleanNickname, password };
    setPendingAuth(request);
    if (caracolSocket.connected) {
      if (authMode === 'register') caracolSocket.emit('caracol:register', request, handleAuthResult);
      else caracolSocket.emit('caracol:login', request, handleAuthResult);
      return;
    }
    setConnection(serverMayHibernate ? 'waking' : 'connecting');
    void wakeServer().then(() => {
      if (!caracolSocket.connected) caracolSocket.connect();
    });
  }

  function selectCity(city: BrazilianCity): void {
    if (!caracolSocket.connected) {
      setFeedback({ tone: 'error', message: 'Reconectando ao mapa. Tente escolher a cidade novamente em instantes.' });
      return;
    }
    caracolSocket.emit('caracol:select-city', { cityId: city.id }, handleActionResult);
  }

  function redirect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const targetNickname = redirectNickname.trim();
    if (!targetNickname || !caracolSocket.connected) return;
    caracolSocket.emit('caracol:redirect', { targetNickname }, handleActionResult);
  }

  function buySpeed(): void {
    if (!caracolSocket.connected) return;
    caracolSocket.emit('caracol:buy-speed', handleActionResult);
  }

  function buyDiscount(): void {
    if (!caracolSocket.connected) return;
    caracolSocket.emit('caracol:buy-discount', handleActionResult);
  }

  function spinRoulette(): void {
    if (!caracolSocket.connected || spinning) return;
    setSpinning(true);
    // Se a conexão cair antes da resposta, o Socket.IO nunca chama o ack; sem o
    // prazo, o botão ficaria em "Girando…" até recarregar a página.
    caracolSocket.timeout(ROULETTE_ACK_TIMEOUT_MS).emit('caracol:roulette', (timedOut, result) => {
      setSpinning(false);
      if (timedOut) {
        setFeedback({ tone: 'error', message: 'A roleta não respondeu. Se o giro valeu, ele aparece quando o mapa sincronizar.' });
        return;
      }
      if (result.ok) {
        setState(result.state);
        setLastSyncedAt(Date.now());
        setRevealItemId(result.itemId);
        setFeedback(null);
        return;
      }
      // Giro repetido não é erro: o cartão já sabe mostrar a espera, só falta o estado novo.
      if (result.code === 'ROULETTE_COOLDOWN') {
        caracolSocket.emit('caracol:sync', (synced) => { if (synced.ok) setState(synced.state); });
        return;
      }
      setFeedback({ tone: 'error', message: result.message });
    });
  }

  function throwBoomerang(targetNickname: string): void {
    if (!caracolSocket.connected) return;
    caracolSocket.emit('caracol:boomerang', { targetNickname }, handleActionResult);
  }

  function loadHistory(beforeId: string | null = null): void {
    if (!caracolSocket.connected) {
      setHistoryError('Reconectando ao mapa. O histórico volta assim que a conexão retornar.');
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    caracolSocket.emit('caracol:history', { beforeId, limit: CARACOL_HISTORY_PAGE_SIZE }, (result) => {
      setHistoryLoading(false);
      if (!result.ok) {
        setHistoryError(result.message);
        return;
      }
      setHistoryEntries((current) => {
        const nextEntries = beforeId === null ? [...result.entries, ...current] : [...current, ...result.entries];
        const unique = new Map(nextEntries.map((entry) => [entry.id, entry]));
        return Array.from(unique.values()).sort((a, b) => b.createdAt - a.createdAt || Number(b.id) - Number(a.id));
      });
      setHistoryCursor(result.nextCursor);
      setHistoryHasMore(result.hasMore);
    });
  }

  function openHistory(): void {
    setShopOpen(false);
    setHistoryOpen(true);
    setHistoryEntries([]);
    setHistoryCursor(null);
    setHistoryHasMore(false);
    setHistoryError(null);
    loadHistory();
  }

  function closeHistory(): void {
    setHistoryOpen(false);
  }

  function openShop(tab: ShopTab = 'player'): void {
    setHistoryOpen(false);
    setShopTab(tab);
    setShopOpen(true);
  }

  function closeShop(): void {
    setShopOpen(false);
  }

  function purchaseCosmetic(itemId: string): void {
    if (!caracolSocket.connected) {
      setFeedback({ tone: 'error', message: 'A loja está esperando a conexão com o mapa.' });
      return;
    }
    caracolSocket.emit('caracol:shop-purchase', { wearer: shopTab, itemId }, handleActionResult);
  }

  function equipCosmetic(slot: CaracolCosmeticSlot, itemId: string | null): void {
    if (!caracolSocket.connected) {
      setFeedback({ tone: 'error', message: 'A loja está esperando a conexão com o mapa.' });
      return;
    }
    caracolSocket.emit('caracol:shop-equip', { wearer: shopTab, slot, itemId }, handleActionResult);
  }

  function handleActionResult(result: CaracolActionResult): void {
    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.message });
      return;
    }
    setState(result.state);
    setLastSyncedAt(Date.now());
    setConnection('online');
    setFeedback({ tone: 'success', message: 'Ação aplicada no mundo.' });
  }

  function leave(): void {
    caracolSocket.emit('caracol:logout');
    caracolSocket.disconnect();
    clearCaracolSessionToken();
    setState(null);
    setRestoringSession(false);
    setPendingAuth(null);
    setPassword('');
    setHistoryOpen(false);
    setShopOpen(false);
    setHistoryEntries([]);
    setRevealItemId(null);
    onExit();
  }

  async function enablePush(): Promise<void> {
    if (isIosDevice() && !isStandaloneMode()) {
      setPushStatus('unavailable');
      setFeedback({ tone: 'neutral', message: 'No iPhone, use Compartilhar → Adicionar à Tela de Início. Depois abra o ícone do Caracol e ative os alertas.' });
      return;
    }
    if (!state?.pushPublicKey) {
      setPushStatus('unavailable');
      setFeedback({ tone: 'error', message: 'O Push ainda não foi configurado no servidor.' });
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPushStatus('unavailable');
      setFeedback({ tone: 'error', message: 'Este navegador não oferece notificações Push.' });
      return;
    }
    setPushStatus('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus('denied');
        setFeedback({ tone: 'error', message: 'As notificações continuam desligadas neste navegador.' });
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw-caracol.js', { scope: '/' });
      const existingSubscription = await registration.pushManager.getSubscription();
      const subscription = existingSubscription ?? await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(state.pushPublicKey),
        });
      caracolSocket.emit('caracol:push-subscribe', subscription.toJSON() as never, (result) => {
        if (!result.ok) {
          setPushStatus('idle');
          setFeedback({ tone: 'error', message: result.message });
          return;
        }
        setState(result.state);
        setPushStatus('enabled');
        setFeedback({ tone: 'success', message: 'Notificações do Caracol ativadas.' });
      });
    } catch {
      setPushStatus('idle');
      setFeedback({ tone: 'error', message: 'Não consegui ativar as notificações neste dispositivo.' });
    }
  }

  if (!state) {
    if (restoringSession) {
      return (
        <main className="app-shell caracol-shell caracol-auth-shell caracol-restore-shell">
          <header className="topbar home-topbar">
            <div className="logo" aria-label="Jogos"><span className="logo-mark caracol-logo-mark">🐌</span><span className="logo-word">JOGOS<br /><b>CARACOL</b></span></div>
            <span className="connection-pill connection-reconnecting"><span className="connection-dot" aria-hidden="true" />reconectando</span>
          </header>
          <section className="caracol-restore-card paper-card" aria-live="polite">
            <span className="caracol-restore-mark">🐌</span>
            <p className="eyebrow">O mapa continua</p>
            <h1>Reabrindo<br /><span>seu lugar.</span></h1>
            <p className="section-lede">Estamos sincronizando suas moedas e sua posição antes de mostrar as ações.</p>
          </section>
        </main>
      );
    }
    return (
      <main className="app-shell caracol-shell caracol-auth-shell">
        <header className="topbar home-topbar">
          <div className="logo" aria-label="Jogos"><span className="logo-mark caracol-logo-mark">🐌</span><span className="logo-word">JOGOS<br /><b>CARACOL</b></span></div>
          <button className="text-button" type="button" onClick={onExit}>Voltar aos jogos</button>
        </header>
        <section className="caracol-auth-layout" aria-labelledby="caracol-auth-title">
          <div className="caracol-auth-intro">
            <p className="eyebrow">Um mapa · uma perseguição · sem fim</p>
            <h1 id="caracol-auth-title">Entre devagar.<br /><span>O caracol espera.</span></h1>
            <p className="section-lede">Escolha uma cidade no Brasil, acumule moedas e tente sobreviver ao jogador mais paciente do país.</p>
            <div className="caracol-fact-strip"><span>0,05 km/h no começo</span><span>sem salas</span><span>senha sem recuperação</span></div>
          </div>
          <div className="caracol-auth-card paper-card">
            <div className="caracol-auth-tabs" role="tablist" aria-label="Acesso ao Caracol">
              <button className={authMode === 'login' ? 'mode-button active' : 'mode-button'} type="button" onClick={() => { setAuthMode('login'); setError(null); }} role="tab" aria-selected={authMode === 'login'}>Entrar</button>
              <button className={authMode === 'register' ? 'mode-button active' : 'mode-button'} type="button" onClick={() => { setAuthMode('register'); setError(null); }} role="tab" aria-selected={authMode === 'register'}>Criar nick</button>
            </div>
            <form className="stack-form" onSubmit={submitAuth}>
              <label className="field-label" htmlFor="caracol-nickname">Seu nick<input id="caracol-nickname" className="text-input" value={nickname} onChange={(event) => setNickname(event.target.value.slice(0, 24))} placeholder="Como o mapa vai te chamar?" autoComplete="username" maxLength={24} /></label>
              <label className="field-label" htmlFor="caracol-password">Sua senha<input id="caracol-password" className="text-input" type="password" value={password} onChange={(event) => setPassword(event.target.value.slice(0, MAX_PASSWORD_LENGTH))} placeholder="mínimo de 8 caracteres" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} maxLength={MAX_PASSWORD_LENGTH} /></label>
              <button className="primary-button full-button caracol-submit" type="submit">{authMode === 'register' ? 'Criar e entrar' : 'Entrar no mapa'} <span aria-hidden="true">↗</span></button>
            </form>
            <p className="caracol-password-warning"><span aria-hidden="true">!</span> Não existe recuperação nem troca de senha. Se esquecer, esta conta fica perdida.</p>
            {error && <InlineNotice tone="error">{error}</InlineNotice>}
            {connection === 'waking' && !error && <InlineNotice tone="neutral">Acordando o servidor…</InlineNotice>}
          </div>
        </section>
      </main>
    );
  }

  const frozen = hasEffect(state, 'freeze');

  return (
    <main className="app-shell caracol-shell caracol-game-shell">
      <header className="topbar home-topbar caracol-topbar">
        <div className="logo" aria-label="Jogos"><span className="logo-mark caracol-logo-mark">🐌</span><span className="logo-word">JOGOS<br /><b>CARACOL</b></span></div>
        <div className="caracol-top-meta"><span className="caracol-live-dot" aria-hidden="true" /> mapa global · {state.players.length} pessoa{state.players.length === 1 ? '' : 's'} no mapa · <span className="caracol-sync-meta">{lastSyncedAt === null ? 'sincronizando' : 'sincronizado'}</span></div>
        <div className="topbar-actions"><span className={`connection-pill connection-${connection}`}><span className="connection-dot" aria-hidden="true" />{connectionLabel(connection)}</span><button className="caracol-shop-trigger" type="button" onClick={() => openShop()} aria-expanded={shopOpen} aria-controls="caracol-shop-drawer"><span aria-hidden="true">✦</span> Loja</button><button className="caracol-history-trigger" type="button" onClick={openHistory} aria-expanded={historyOpen} aria-controls="caracol-history-drawer"><span aria-hidden="true">↺</span> Histórico</button><button className="text-button" type="button" onClick={leave}>Sair</button></div>
      </header>
      {connection !== 'online' && <div className="caracol-sync-banner" role="status"><span className="connection-dot" aria-hidden="true" /> A tela está reconectando; suas ações voltam quando o mapa sincronizar.</div>}
      {state.needsCity ? (
        <section className="caracol-city-layout" aria-labelledby="caracol-city-title">
          <div className="caracol-city-copy">
            <p className="eyebrow">{state.you.alive ? 'Primeiro passo' : 'Você foi alcançado'}</p>
            <h1 id="caracol-city-title">Escolha onde<br /><span>você mora.</span></h1>
            <p className="section-lede">{state.you.alive ? 'O caracol está em Brasília. Quando você entrar no mapa, ele começa a andar.' : 'Suas moedas foram zeradas. O caracol continua de onde alcançou você. Escolha uma nova cidade para voltar ao mapa.'}</p>
            <CityPicker query={cityQuery} onQueryChange={setCityQuery} suggestions={citySuggestions} onSelect={selectCity} disabled={connection !== 'online'} />
            {feedback && <InlineNotice tone={feedback.tone}>{feedback.message}</InlineNotice>}
            <RouletteCard state={state} online={connection === 'online'} spinning={spinning} onSpin={spinRoulette} onBoomerang={throwBoomerang} />
          </div>
          <BrazilMap state={state} geoJson={geoJson} />
        </section>
      ) : (
        <section className="caracol-layout" aria-labelledby="caracol-title">
          <div className="caracol-map-column">
            <div className="caracol-heading-row">
              <div><p className="eyebrow">O mapa não fecha · a perseguição continua</p><h1 id="caracol-title">Corra devagar.<br /><span>O caracol não.</span></h1></div>
              <div className="caracol-speed-readout"><strong>{formatSpeed(state.world.snail.speedKmh)}</strong><span>km/h agora</span></div>
            </div>
            {notice && <InlineNotice tone="neutral">{notice}</InlineNotice>}
            <BrazilMap state={state} geoJson={geoJson} />
            <CaracolMapLegend snailOutfit={state.world.snail.outfit} />
          </div>
          <aside className="caracol-control-column">
            <div className="caracol-wallet paper-card"><CaracolMedallion wearer="player" outfit={state.shop.player.outfit} size={64} label={`${state.you.nickname} vestido`} /><div className="caracol-wallet-copy"><span className="micro-label">Seu bolso</span><strong>{state.you.coins}</strong><span>moedas</span><div className="caracol-player-line"><b>{state.you.nickname}</b><span>{state.you.city?.name} · {state.you.city?.uf}</span></div></div></div>
            <RouletteCard state={state} online={connection === 'online'} spinning={spinning} onSpin={spinRoulette} onBoomerang={throwBoomerang}>
              {hasEffect(state, 'mushroom') && <div className="caracol-roulette-mushroom"><span className="micro-label">Cogumelo · troca de cidade</span><CityPicker query={cityQuery} onQueryChange={setCityQuery} suggestions={citySuggestions} onSelect={selectCity} disabled={connection !== 'online'} /></div>}
            </RouletteCard>
            <div className="caracol-control-card paper-card">
              <div className="panel-heading"><div><span className="micro-label">O bicho</span><h2>{snailHeadline(state)}</h2></div><CaracolMedallion wearer="snail" outfit={state.world.snail.outfit} size={72} label="Caracol vestido" /></div>
              <div className="caracol-metrics"><div><span>distância</span><strong>{state.world.snail.hidden ? 'escondida' : state.world.snail.distanceKm === null ? '—' : formatDistance(state.world.snail.distanceKm)}</strong></div><div><span>chega em</span><strong>{state.world.snail.hidden ? 'escondido' : formatEta(state.world.snail.etaMs)}</strong></div></div>
              {state.world.snail.hidden && <p className="caracol-ink-note">Tinta do Blooper: você não vê onde o caracol está nem quando ele chega.</p>}
              <form className="caracol-action-form" onSubmit={redirect}><label className="field-label" htmlFor="caracol-target">Mudar o alvo<input id="caracol-target" className="text-input" value={redirectNickname} onChange={(event) => setRedirectNickname(event.target.value)} placeholder="nick de alguém vivo" autoComplete="off" /></label><button className="ghost-button caracol-action-button" type="submit" disabled={connection !== 'online' || frozen}>Enviar para essa pessoa <span>{hasEffect(state, 'fire-flower') ? 'grátis · Flor de Fogo' : `${state.world.snail.redirectCost} moedas`}</span></button></form>
              <div className="caracol-buy-row"><button className="primary-button caracol-buy-button" type="button" onClick={buySpeed} disabled={connection !== 'online' || frozen}>Acelerar para {(state.world.snail.speedLevel + 1) * 100} km/h <span>{state.world.snail.speedCost} moedas</span></button><button className="ghost-button caracol-discount-button" type="button" onClick={buyDiscount} disabled={connection !== 'online' || frozen}>Desconto {state.you.speedDiscountLevel}/2{state.you.discountCost === null ? '' : ` · ${state.you.discountCost} moedas`}</button><p className="caracol-discount-note">Seu desconto vale para redirecionar o alvo e acelerar o caracol.</p></div>
              {feedback && <InlineNotice tone={feedback.tone}>{feedback.message}</InlineNotice>}
            </div>
            <div className="caracol-alert-card paper-card"><div><span className="micro-label">Fique sabendo</span><strong>{iosDevice && !standaloneMode ? 'Instale para receber alertas.' : 'O caracol não pede licença.'}</strong><p>{iosDevice && !standaloneMode ? 'No iPhone: Compartilhar → Adicionar à Tela de Início. Abra o ícone e ligue os alertas por lá.' : 'Ative o alerta para ser avisado mesmo com o jogo fechado.'}</p></div><button className="text-button" type="button" onClick={() => void enablePush()} disabled={pushStatus === 'working' || pushStatus === 'enabled' || (iosDevice && !standaloneMode)}>{pushStatus === 'enabled' ? 'Alertas ligados' : pushStatus === 'working' ? 'Ligando…' : iosDevice && !standaloneMode ? 'Instale primeiro' : 'Ativar alertas'}</button></div>
            <CaracolPlayersCard players={state.players} targetAccountId={state.world.snail.targetAccountId} />
          </aside>
        </section>
      )}
      {(historyOpen || shopOpen) && <button className="caracol-history-backdrop" type="button" aria-label="Fechar painel" onClick={() => { closeHistory(); closeShop(); }} />}
      <aside id="caracol-history-drawer" className={`caracol-history-drawer ${historyOpen ? 'is-open' : ''}`} aria-label="Histórico do jogo" aria-hidden={!historyOpen}>
        <div className="caracol-history-head"><div><span className="micro-label">Mapa global</span><h2>O que aconteceu</h2><p>As ações mais recentes de todos os jogadores.</p></div><button className="caracol-history-close" type="button" onClick={closeHistory} aria-label="Fechar histórico">×</button></div>
        <div className="caracol-history-body" aria-live="polite">
          {historyLoading && historyEntries.length === 0 && <div className="caracol-history-empty">Carregando as últimas ações…</div>}
          {!historyLoading && historyEntries.length === 0 && !historyError && <div className="caracol-history-empty">Ainda não aconteceu nada por aqui.</div>}
          {historyError && <InlineNotice tone="error">{historyError}</InlineNotice>}
          {historyEntries.length > 0 && <ol className="caracol-history-list">{historyEntries.map((entry) => <li className="caracol-history-item" key={entry.id}><span className={`caracol-history-icon history-icon-${entry.type}`} aria-hidden="true">{historyIcon(entry.type)}</span><div><p>{entry.message}</p><time dateTime={new Date(entry.createdAt).toISOString()}>{formatHistoryTime(entry.createdAt)}</time></div></li>)}</ol>}
        </div>
        <div className="caracol-history-foot">{historyHasMore ? <button className="ghost-button caracol-history-more" type="button" onClick={() => loadHistory(historyCursor)} disabled={historyLoading}>{historyLoading ? 'Carregando…' : `Carregar mais ${CARACOL_HISTORY_PAGE_SIZE}`}</button> : historyEntries.length > 0 ? <span>Fim do histórico</span> : null}</div>
      </aside>
      <CaracolShopDrawer state={state} open={shopOpen} tab={shopTab} onTabChange={setShopTab} onClose={closeShop} onPurchase={purchaseCosmetic} onEquip={equipCosmetic} />
      {revealItemId && <RouletteReveal itemId={revealItemId} state={state} onClose={() => setRevealItemId(null)} />}
    </main>
  );
}

function CityPicker({ query, onQueryChange, suggestions, onSelect, disabled }: { query: string; onQueryChange: (value: string) => void; suggestions: BrazilianCity[]; onSelect: (city: BrazilianCity) => void; disabled: boolean }): JSX.Element {
  return <div className="caracol-city-picker"><label className="field-label" htmlFor="caracol-city-search">Procure sua cidade<input id="caracol-city-search" className="text-input" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Ex.: Recife, Manaus, Bauru…" autoComplete="off" /></label>{suggestions.length === 0 ? <p className="caracol-city-hint">Digite pelo menos duas letras. Todas as cidades do Brasil estão aqui.</p> : <div className="caracol-city-results" role="listbox" aria-label="Cidades encontradas">{suggestions.map((city) => <button type="button" role="option" className="caracol-city-option" key={city.id} onClick={() => onSelect(city)} disabled={disabled}><span>{city.name}</span><b>{city.uf}</b></button>)}</div>}</div>;
}

function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function formatSpeed(speed: number): string {
  return speed < 1 ? speed.toFixed(2).replace('.', ',') : speed.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function formatDistance(distance: number): string {
  if (distance < 1) return `${Math.round(distance * 1_000)} m`;
  return `${distance.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

function formatEta(etaMs: number | null): string {
  if (etaMs === null) return 'parado';
  if (etaMs > 365 * 24 * 60 * 60 * 1_000) return 'muito longe';
  const totalMinutes = Math.max(1, Math.round(etaMs / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h${totalMinutes % 60 ? ` ${totalMinutes % 60}min` : ''}`;
}

function historyIcon(type: CaracolHistoryEntry['type']): string {
  const icons: Record<CaracolHistoryEntry['type'], string> = {
    account: '＋',
    city: '⌂',
    coins: '¢',
    redirect: '↝',
    speed: '↯',
    discount: '%',
    target: '◎',
    approaching: '…',
    death: '✕',
    shop: '✦',
    roulette: '✺',
  };
  return icons[type];
}

function hasEffect(state: CaracolStateView, itemId: CaracolRouletteItemId): boolean {
  return state.you.effects.some((effect) => effect.itemId === itemId && effect.expiresAt > state.world.serverNow);
}

function snailHeadline(state: CaracolStateView): string {
  const { snail } = state.world;
  if (snail.targetNickname) return `Atrás de ${snail.targetNickname}`;
  // Depois de uma morte o caracol fica onde alcançou a pessoa: só dorme em Brasília quem está em Brasília.
  const inBrasilia = snail.lat !== null && snail.lon !== null
    && Math.abs(snail.lat - CARACOL_BRAZILIA.lat) < 1e-4 && Math.abs(snail.lon - CARACOL_BRAZILIA.lon) < 1e-4;
  return inBrasilia ? 'Dormindo em Brasília' : 'Sem alvo no mapa';
}

function formatHistoryTime(timestamp: number): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(timestamp));
}

function connectionLabel(connection: ConnectionState): string {
  const labels: Record<ConnectionState, string> = {
    offline: 'desconectado',
    connecting: 'conectando',
    waking: 'acordando servidor',
    online: 'ao vivo',
    reconnecting: 'reconectando',
  };
  return labels[connection];
}

function readCaracolSessionToken(): string | null {
  try {
    const value = sessionStorage.getItem(CARACOL_SESSION_KEY);
    return value && value.length >= 32 ? value : null;
  } catch {
    return null;
  }
}

function saveCaracolSessionToken(token: string): void {
  try {
    sessionStorage.setItem(CARACOL_SESSION_KEY, token);
  } catch {
    // O jogo continua funcionando com login manual se o navegador bloquear o storage.
  }
}

function clearCaracolSessionToken(): void {
  try {
    sessionStorage.removeItem(CARACOL_SESSION_KEY);
  } catch {
    // Nada a fazer: a sessão do socket ainda será encerrada.
  }
}

function isIosDevice(): boolean {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneMode(): boolean {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return Boolean(standaloneNavigator.standalone) || window.matchMedia('(display-mode: standalone)').matches;
}

function decodeVapidKey(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const decoded = window.atob(base64);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function InlineNotice({ tone, children }: { tone: 'neutral' | 'success' | 'error'; children: string }): JSX.Element {
  return <div className={`inline-notice notice-${tone}`} role="status"><span aria-hidden="true">{tone === 'error' ? '!' : tone === 'success' ? '✓' : '·'}</span>{children}</div>;
}
