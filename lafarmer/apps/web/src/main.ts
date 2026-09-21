import Phaser from 'phaser';
import { hairs, outfits, type HairId, type OutfitId } from '@lafarmer/content-client';
import { createGame } from './game';
import { buyListing, createListing, getMarket, login, register, RealtimeClient, updateProfile, type PlayerProfile } from './network';
import './styles.css';

type AuthMode = 'login' | 'create'; type Screen = 'auth' | 'confirm' | 'onboarding' | 'game';
const root = document.querySelector<HTMLDivElement>('#app')!;
const realtime = new RealtimeClient();
let game: Phaser.Game | undefined; let mode: AuthMode = 'login'; let screen: Screen = 'auth';
let draft = { nick: '', password: '' }; let profile: PlayerProfile = { nick: '', name: '', outfit: 'forest', hair: 'short' }; let coins = 1000; let inventory: Record<string, number> = {};
let authToken = '';

function render(): void {
  if (screen === 'game') { renderGame(); return; }
  game?.destroy(true); game = undefined; root.innerHTML = '<div class="app-shell"></div>';
  const shell = root.firstElementChild as HTMLDivElement;
  if (screen === 'auth') renderAuth(shell); if (screen === 'confirm') renderConfirm(shell); if (screen === 'onboarding') renderOnboarding(shell);
}

function renderAuth(shell: HTMLDivElement): void {
  shell.innerHTML = `<main class="entry" aria-labelledby="auth-title"><div class="entry-grid"><section class="brand-block"><p class="eyebrow">um vale para chamar de seu</p><h1 id="auth-title">La<span>Farmer</span></h1><p>Plante, cuide e troque histórias com quem vive no mesmo vale.</p><span class="entry-note">um mundo compartilhado, começando devagar</span></section><section class="panel auth-panel" aria-label="Acesso ao jogo"><div class="panel-head"><h2>${mode === 'login' ? 'Volte para o vale' : 'Abra sua porteira'}</h2><p>${mode === 'login' ? 'Entre com o nick que você guardou.' : 'Crie um nick e guarde a senha antes de começar.'}</p></div><div class="tabs" role="tablist" aria-label="Acesso"><button class="tab" data-mode="login" role="tab" aria-selected="${mode === 'login'}">Entrar</button><button class="tab" data-mode="create" role="tab" aria-selected="${mode === 'create'}">Criar nick</button></div><form id="auth-form" novalidate><div class="field"><label for="nick">Seu nick</label><input id="nick" name="nick" autocomplete="username" maxlength="20" required placeholder="ex.: lua-do-rio" value="${escapeHtml(draft.nick)}"></div><div class="field"><label for="password">Sua senha</label><input id="password" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="8" required placeholder="mínimo de 8 caracteres"></div><p class="hint">Não existe recuperação nem troca de senha. Guarde as credenciais.</p><p id="auth-error" class="error" role="alert"></p><button class="primary" type="submit">${mode === 'login' ? 'Entrar no mapa' : 'Criar e continuar'}</button></form><p class="status"><span class="live-dot ${realtime.url ? '' : 'offline'}"></span> ${realtime.url ? `servidor: <strong>${escapeHtml(realtime.url)}</strong>` : 'modo de demonstração local · WebSocket configurável'}</p></section></div></main>`;
  shell.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => { mode = button.dataset.mode as AuthMode; render(); }));
  shell.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); const nick = String(form.get('nick') || '').trim(); const password = String(form.get('password') || ''); const error = shell.querySelector<HTMLParagraphElement>('#auth-error')!;
    if (!/^[\p{L}0-9][\p{L}0-9 _-]{2,19}$/u.test(nick)) { error.textContent = 'Use um nick de 3 a 20 caracteres.'; return; }
    if (password.length < 8) { error.textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
    draft = { nick, password }; error.textContent = 'Conectando ao vale…';
    try {
      const result = mode === 'create' ? await register(nick, password) : await login(nick, password);
      authToken = result.token; profile.nick = nick; profile.name = result.player.name; profile.outfit = result.player.appearance.clothing; profile.hair = result.player.appearance.hair; coins = result.player.coins; screen = 'confirm'; render();
    } catch (requestError) {
      error.textContent = requestError instanceof Error && requestError.message === 'nick_taken' ? 'Esse nick já está ocupado.' : 'Não foi possível entrar. Confira os dados e o servidor.';
    }
  });
}

function renderConfirm(shell: HTMLDivElement): void {
  shell.innerHTML = `<main class="entry" aria-labelledby="confirm-title"><section class="panel confirm-panel"><div class="confirm-icon" aria-hidden="true">✓</div><p class="eyebrow">antes de entrar</p><h2 id="confirm-title">Guarde seu acesso.</h2><p>O LaFarmer não tem recuperação de senha. Se ela for perdida, esta conta também fica inacessível.</p><div class="credential-slip"><strong>${escapeHtml(draft.nick)}</strong><span>Sua senha foi digitada nesta sessão. Anote-a em um lugar seguro.</span></div><label class="checkline"><input id="saved-credentials" type="checkbox"><span>Eu guardei meu nick e minha senha e entendo que não haverá recuperação.</span></label><div class="actions"><button id="back-auth" class="secondary" type="button">Voltar</button><button id="confirm-access" class="primary" type="button" disabled>Continuar</button></div></section></main>`;
  const checkbox = shell.querySelector<HTMLInputElement>('#saved-credentials')!; const continueButton = shell.querySelector<HTMLButtonElement>('#confirm-access')!;
  checkbox.addEventListener('change', () => { continueButton.disabled = !checkbox.checked; }); shell.querySelector('#back-auth')!.addEventListener('click', () => { screen = 'auth'; render(); }); continueButton.addEventListener('click', () => { screen = 'onboarding'; render(); });
}

function renderOnboarding(shell: HTMLDivElement): void {
  shell.innerHTML = `<main class="entry" aria-labelledby="onboarding-title"><section class="panel onboarding-panel"><p class="eyebrow">primeiro dia no vale</p><h2 id="onboarding-title">Chegue do seu jeito.</h2><p>Escolha o visual que combina com você. Aqui, roupa e cabelo são expressão — não categoria.</p><div class="onboarding-grid"><div class="avatar-preview" aria-label="Prévia do personagem"><div id="preview-person" class="preview-person"><div id="preview-hair" class="preview-hair"></div><div class="preview-head"></div><span class="preview-eye left"></span><span class="preview-eye right"></span><div id="preview-body" class="preview-body"></div><div class="preview-legs"></div><div class="preview-shoes"></div></div><span class="preview-caption">um personagem do seu jeito</span></div><form id="onboarding-form"><div class="field"><label for="character-name">Nome do personagem</label><input id="character-name" name="character-name" maxlength="20" required value="${escapeHtml(profile.name)}" placeholder="ex.: Jasmim"></div><div class="choice-group"><h3>Roupa</h3><div class="choices" role="group" aria-label="Roupa">${outfits.map((item) => `<button type="button" class="choice outfit-choice" data-outfit="${item.id}" aria-pressed="${profile.outfit === item.id}">${item.label}</button>`).join('')}</div></div><div class="choice-group"><h3>Cabelo</h3><div class="choices" role="group" aria-label="Cabelo">${hairs.map((item) => `<button type="button" class="choice hair-choice" data-hair="${item.id}" aria-pressed="${profile.hair === item.id}">${item.label}</button>`).join('')}</div></div><p id="onboarding-error" class="error" role="alert"></p><button class="primary" type="submit">Entrar no meu vale</button></form></div></section></main>`;
  const updatePreview = () => { shell.querySelector<HTMLDivElement>('#preview-body')!.style.background = outfits.find((item) => item.id === profile.outfit)?.swatch || '#315d4a'; shell.querySelector<HTMLDivElement>('#preview-hair')!.classList.toggle('long', profile.hair === 'long'); };
  shell.querySelectorAll<HTMLButtonElement>('[data-outfit]').forEach((button) => button.addEventListener('click', () => { profile.outfit = button.dataset.outfit as OutfitId; shell.querySelectorAll('[data-outfit]').forEach((item) => item.setAttribute('aria-pressed', String(item === button))); updatePreview(); }));
  shell.querySelectorAll<HTMLButtonElement>('[data-hair]').forEach((button) => button.addEventListener('click', () => { profile.hair = button.dataset.hair as HairId; shell.querySelectorAll('[data-hair]').forEach((item) => item.setAttribute('aria-pressed', String(item === button))); updatePreview(); }));
  updatePreview();
  shell.querySelector<HTMLFormElement>('#onboarding-form')!.addEventListener('submit', async (event) => { event.preventDefault(); const name = String(new FormData(event.currentTarget as HTMLFormElement).get('character-name') || '').trim(); const error = shell.querySelector<HTMLParagraphElement>('#onboarding-error')!; if (name.length < 2) { error.textContent = 'Escolha um nome com pelo menos 2 caracteres.'; return; } try { profile.name = name; await updateProfile(authToken, profile); screen = 'game'; render(); } catch { error.textContent = 'Não foi possível salvar o personagem.'; } });
}

function renderGame(): void {
  root.innerHTML = `<main class="game-shell" aria-label="Mundo do LaFarmer"><div id="game-root"></div><div class="game-hud"><div class="hud-top"><div class="hud-pill"><span class="coin">¢</span><span id="coins-value">${coins.toLocaleString('pt-BR')} moedas</span><span id="connection-status" class="live-dot ${realtime.status === 'connected' ? '' : 'offline'}" aria-label="${realtime.status === 'connected' ? 'online' : 'modo local'}"></span></div><div class="hud-pill hud-help">${escapeHtml(profile.name)}, use <kbd>WASD</kbd> ou as setas para andar</div></div><div class="hud-actions"><button id="plant-tomato" type="button">Plantar tomate · 10¢</button><button id="adopt-cow" type="button">Adotar vaca · 100¢</button><button id="adopt-dino" type="button">Adotar dino · 300¢</button><button id="open-market" type="button">Abrir mercadinho</button><p id="action-message" role="status"></p></div><div class="hud-bottom">Online rende <strong>10×</strong> moedas. <kbd>E</kbd> cuida/colhe perto do plantio ou abre o mercadinho.</div></div><section id="market-panel" class="market-panel" hidden aria-label="Mercadinho"><div class="market-card"><button id="close-market" class="market-close" type="button">Fechar</button><p class="eyebrow">mercadinho do vale</p><h2>Compre de outros jogadores</h2><p id="market-status" class="hint">Carregando anúncios…</p><div id="market-list" class="market-list"></div></div></section></main>`;
  const gameRoot = root.querySelector<HTMLDivElement>('#game-root')!;
  void realtime.connect(authToken).then((status) => {
    const indicator = root.querySelector<HTMLSpanElement>('#connection-status');
    if (indicator) { indicator.classList.toggle('offline', status !== 'connected'); indicator.setAttribute('aria-label', status === 'connected' ? 'online' : 'modo local'); }
  });
  const message = (text: string) => { const target = root.querySelector<HTMLParagraphElement>('#action-message'); if (target) target.textContent = text; };
  root.querySelector('#plant-tomato')?.addEventListener('click', () => { realtime.action('farm.plant', { contentId: 'tomato' }); message('Tomate plantado. Cuide dele com E.'); });
  root.querySelector('#adopt-cow')?.addEventListener('click', () => { realtime.action('farm.adopt', { contentId: 'cow' }); message('Sua vaca chegou ao vale. Cuide dela com E.'); });
  root.querySelector('#adopt-dino')?.addEventListener('click', () => { realtime.action('farm.adopt', { contentId: 'dinosaur' }); message('Seu dinossauro chegou ao vale.'); });
  root.querySelector('#open-market')?.addEventListener('click', () => openMarketPanel());
  root.querySelector('#close-market')?.addEventListener('click', () => { const panel = root.querySelector<HTMLElement>('#market-panel'); if (panel) panel.hidden = true; });
  game = createGame(gameRoot, { profile, realtime, onCoins: (value) => { coins = value; const target = root.querySelector('#coins-value'); if (target) target.textContent = `${coins.toLocaleString('pt-BR')} moedas`; }, onInventory: (value) => { inventory = value; }, onMarket: () => openMarketPanel() });
}

async function openMarketPanel(): Promise<void> {
  const panel = root.querySelector<HTMLElement>('#market-panel'); const list = root.querySelector<HTMLDivElement>('#market-list'); const status = root.querySelector<HTMLParagraphElement>('#market-status');
  if (!panel || !list || !status) return;
  panel.hidden = false; status.textContent = 'Carregando anúncios…'; list.innerHTML = '';
  try {
    const result = await getMarket();
    status.textContent = result.listings.length ? `${result.listings.length} anúncio(s) disponível(is)` : 'Ainda não há produtos à venda.';
    const sellable = Object.entries(inventory).filter(([, quantity]) => quantity > 0);
    if (sellable.length) {
      const sellTitle = document.createElement('p'); sellTitle.className = 'market-section-title'; sellTitle.textContent = 'Seus produtos'; list.append(sellTitle);
      sellable.forEach(([contentId, quantity]) => { const item = document.createElement('article'); item.className = 'market-item'; item.innerHTML = `<div><strong>${escapeHtml(contentId)}</strong><span>${quantity} unidade(s) no inventário</span></div><button type="button">Vender por 30¢</button>`; item.querySelector('button')?.addEventListener('click', async () => { try { await createListing(authToken, contentId, 1, 30); inventory[contentId] -= 1; messageFromRoot('Produto anunciado no mercadinho.'); await openMarketPanel(); } catch { messageFromRoot('Não foi possível criar o anúncio.'); } }); list.append(item); });
    }
    result.listings.forEach((listing) => {
      const item = document.createElement('article'); item.className = 'market-item'; item.innerHTML = `<div><strong>${escapeHtml(listing.contentId)}</strong><span>${listing.quantity} unidade(s) · ${listing.unitPrice} moedas cada</span><small>por ${escapeHtml(listing.sellerName)}</small></div><button type="button">Comprar</button>`;
      item.querySelector('button')?.addEventListener('click', async () => { try { const purchased = await buyListing(authToken, listing.id); coins = purchased.coins; inventory = purchased.inventory; const target = root.querySelector('#coins-value'); if (target) target.textContent = `${coins.toLocaleString('pt-BR')} moedas`; messageFromRoot(`Compra realizada: ${listing.quantity} ${listing.contentId}.`); await openMarketPanel(); } catch { messageFromRoot('Não foi possível comprar este anúncio.'); } }); list.append(item);
    });
  } catch { status.textContent = 'Mercadinho indisponível agora.'; }
}

function messageFromRoot(text: string): void { const target = root.querySelector<HTMLParagraphElement>('#action-message'); if (target) target.textContent = text; }

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character)); }
render();
