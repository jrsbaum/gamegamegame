import './styles.css';
import { VillageWorld, type Selection } from './world';
import { statusLabels, sizeLabels, type Snapshot, type Me, type OwnRobot } from './types';

const app = document.querySelector<HTMLDivElement>('#app')!;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let me: Me | null = null;
let snapshot: Snapshot | null = null;
let simulated = true, step = 0, playing = false, authMode = 'login';
let selection: Selection = null;
let view: 'village' | 'office' = 'village';
let timer: ReturnType<typeof setTimeout> | undefined;
let world: VillageWorld | null = null;
let lastToken: { id: string; token: string } | null = null;
let polling = false;

app.innerHTML = `
  <main class="village-shell">
    <header class="topbar"><a class="platform" href="https://gamegamegame.site/" aria-label="Voltar à GameGameGame"><span>G</span> GAMEGAMEGAME</a><span class="top-note">um lugar para trabalhar junto</span><button class="quiet" data-action="mode" hidden></button></header>
    <section class="intro"><div><p class="eyebrow">Seu cantinho, com a turma</p><h1>Vila dos Agentes<span aria-hidden="true">.</span></h1><p>Você cuida da sua mesa. Seus robôs cuidam dos seus chats.</p></div><div class="intro-stamp"><span aria-hidden="true">⌂</span><span>Portas abertas.<br>Bom trabalho.</span></div></section>
    <section class="world-layout" aria-label="Vila e escritório">
      <div class="diorama">
        <div class="scene-toolbar"><div class="scene-tabs" role="group" aria-label="Cenário"><button data-action="view" data-view="village" aria-pressed="true">Jardim</button><button data-action="view" data-view="office" aria-pressed="false">Entrar no escritório <span aria-hidden="true">↗</span></button></div><span class="mode-badge" id="mode-label">Demonstração simulada</span></div>
        <div id="stage" class="stage" aria-label="Diorama da vila em 3D"><div class="scene-note" id="scene-note">O escritório fica no centro da vila.</div><div class="scene-sign"><span aria-hidden="true">☀</span> um dia bom por aqui</div></div>
        <div class="world-caption"><p id="world-count">Preparando a vila…</p><span>Clique numa mesa ou escolha na lista.</span></div>
        <div class="demo-controls" id="demo-controls"><button class="primary" data-action="play">Simular trabalho <span aria-hidden="true">▶</span></button><button class="quiet" data-action="next">Próximo sinal</button><span id="demo-step">0 / 20 sinais</span></div>
        <p class="honest-note" id="honest-note">Pessoas e eventos fictícios. Esta demonstração não acompanha nenhuma conta real.</p>
      </div>
      <aside class="notebook" aria-label="Caderninho da vila">
        <div class="notebook-heading"><span aria-hidden="true">✦</span><h2>Na nossa mesa</h2><span class="small-label">1 robô = 1 chat</span></div>
        <div id="selection" class="selection"><p class="muted">Escolha um robô para ver o que ele compartilha.</p></div>
        <div class="roster-heading"><h3>Moradores e robôs</h3><span id="roster-count"></span></div><div id="roster" class="roster"></div>
        <div id="account-panel" class="account-panel"></div>
      </aside>
    </section>
    <p id="notice" class="notice" role="status" aria-live="polite"></p>
    <footer><span>Vila dos Agentes · GameGameGame</span><span>Compartilhe só o que escolher.</span></footer>
  </main>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const notify = (message: string, error = false) => { el('notice').textContent = message; el('notice').classList.toggle('is-error', error); };
async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível conectar à vila.');
  return result as T;
}
function setView(next: 'village' | 'office') {
  view = next; world?.setView(view);
  app.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  el('scene-note').textContent = view === 'village' ? 'O escritório fica no centro da vila.' : 'Cada mesa tem um dono. Cada robô tem um chat.';
}
function select(next: Selection) { selection = next; world?.select(next); renderSelection(); renderRoster(); }
function renderSelection() {
  const robot = snapshot?.robots.find(r => selection?.kind === 'robot' && r.id === selection.id);
  const member = snapshot?.members.find(m => m.id === (robot?.ownerId ?? (selection?.kind === 'member' ? selection.id : '')));
  if (!member) { el('selection').innerHTML = '<p class="muted">Escolha uma mesa ou um robô. O caderninho mostra o que o dono autorizou.</p>'; return; }
  if (!robot) {
    el('selection').innerHTML = `<p class="eyebrow">Mesa de ${esc(member.displayName)}</p><h3>${sizeLabels[member.deskSize]}</h3><p class="muted">${member.online ? 'O morador está por aqui.' : 'O morador está offline. Seus robôs podem continuar.'}</p><p>${snapshot?.robots.filter(r => r.ownerId === member.id).length ?? 0} chats neste cantinho.</p>`;
    return;
  }
  const shared = robot.title ? `<h3 class="task-title">${esc(robot.title)}</h3>${robot.description ? `<p class="task-description">${esc(robot.description)}</p>` : ''}` : '<p class="privacy-note"><span aria-hidden="true">◌</span> Este robô compartilha só seu estado.</p>';
  const signal = simulated ? 'Sinal fictício da demonstração.' : robot.lastSignalAt ? `Último sinal: ${new Date(robot.lastSignalAt).toLocaleString('pt-BR')}.` : 'Ainda não recebeu um sinal do coletor.';
  el('selection').innerHTML = `<p class="eyebrow">${esc(member.displayName)} · ${esc(robot.provider)}</p><div class="robot-heading"><h3>${esc(robot.label)}</h3><span class="status-dot status-${esc(robot.status)}" aria-hidden="true"></span></div><p class="activity">${statusLabels[robot.status] ?? 'Sem sinal'}</p>${shared}<p class="signal-time">${esc(signal)}</p>`;
}
function renderRoster() {
  if (!snapshot) return;
  el('roster-count').textContent = String(snapshot.members.length);
  el('roster').innerHTML = snapshot.members.map(member => {
    const bots = snapshot!.robots.filter(r => r.ownerId === member.id);
    return `<div class="resident"><button class="resident-name" data-action="select-member" data-id="${esc(member.id)}" aria-pressed="${selection?.kind === 'member' && selection.id === member.id}"><span class="presence ${member.online ? 'online' : ''}" aria-hidden="true"></span>${esc(member.displayName)}<span>${member.online ? 'por aqui' : 'offline'}</span></button><div class="robot-list">${bots.length ? bots.map(robot => `<button data-action="select-robot" data-id="${esc(robot.id)}" aria-pressed="${selection?.kind === 'robot' && selection.id === robot.id}"><span class="bot-symbol" aria-hidden="true">▣</span><span>${esc(robot.label)}<small>${statusLabels[robot.status] ?? 'Sem sinal'}</small></span><span class="status-dot status-${esc(robot.status)}" aria-hidden="true"></span></button>`).join('') : '<p class="empty-roster">Ainda sem robôs. O cantinho já está reservado.</p>'}</div></div>`;
  }).join('');
}
function renderScene() {
  if (!snapshot) return;
  const active = snapshot.robots.filter(r => ['working', 'reading', 'tool', 'waiting'].includes(r.status)).length;
  el('world-count').textContent = `${snapshot.members.length} moradores · ${snapshot.robots.length} chats · ${active} em atividade`;
  el('mode-label').textContent = simulated ? 'Demonstração simulada' : 'Nossa vila';
  el('demo-controls').hidden = !simulated;
  el('honest-note').textContent = simulated ? 'Pessoas e eventos fictícios. Esta demonstração não acompanha nenhuma conta real.' : 'Os estados são o último sinal recebido. Conecte um coletor próprio para enviar eventos dos seus chats.';
  const mode = app.querySelector<HTMLButtonElement>('[data-action="mode"]')!;
  mode.hidden = !me; mode.textContent = simulated ? 'Voltar à nossa vila' : 'Ver demonstração';
  el('demo-step').textContent = `${step} / ${snapshot.totalSteps ?? 20} sinais`;
  const play = app.querySelector<HTMLButtonElement>('[data-action="play"]')!;
  play.textContent = playing ? 'Pausar simulação' : step === snapshot.totalSteps ? 'Simular novamente' : 'Simular trabalho ▶';
  app.querySelector<HTMLButtonElement>('[data-action="next"]')!.disabled = playing || step === snapshot.totalSteps;
  world?.setSnapshot(snapshot); world?.select(selection); renderSelection(); renderRoster();
}
function authPanel() {
  const creating = authMode === 'register';
  return `<h3>${creating ? 'Reserve seu cantinho' : 'Entre na nossa vila'}</h3><p class="muted">Sua conta é só desta vila. Peça o convite a quem chamou a turma.</p><form data-form="auth"><label>Nome de acesso<input name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[a-z0-9_-]+" required placeholder="ex.: renatin"></label>${creating ? '<label>Como a turma te chama<input name="displayName" maxlength="32" required autocomplete="nickname"></label>' : ''}<label>Senha<input name="password" type="password" autocomplete="${creating ? 'new-password' : 'current-password'}" minlength="${creating ? 10 : 1}" maxlength="128" required></label>${creating ? '<label>Código de convite<input name="inviteCode" type="password" required autocomplete="off"></label>' : ''}<button class="primary" type="submit">${creating ? 'Criar meu cantinho' : 'Entrar'}</button></form><button class="text-button" data-action="auth-mode">${creating ? 'Já tenho conta' : 'Quero criar meu cantinho'}</button>`;
}
function robotEditor(robot: OwnRobot) {
  return `<details class="robot-editor"><summary>${esc(robot.label)} <span>${esc(robot.provider)}</span></summary><form data-form="robot-edit" data-id="${esc(robot.id)}"><label>Nome do robô<input name="label" value="${esc(robot.label)}" maxlength="32" required></label><label>O que os amigos veem<select name="privacy"><option value="none" ${robot.privacy === 'none' ? 'selected' : ''}>Não compartilhar · só estado</option><option value="title" ${robot.privacy === 'title' ? 'selected' : ''}>Compartilhar título</option><option value="description" ${robot.privacy === 'description' ? 'selected' : ''}>Compartilhar título e descrição</option></select></label><label>Título autorizado<input name="title" maxlength="120" value="${esc(robot.title)}"></label><label>Descrição autorizada<textarea name="description" maxlength="280" rows="2">${esc(robot.description)}</textarea></label><p class="small-help">Você escolhe estes textos. Nenhum prompt é copiado automaticamente.</p><button class="primary" type="submit">Salvar compartilhamento</button></form><p class="small-help">Chat privado: ${esc(robot.sessionId)}</p><div class="robot-actions"><button class="quiet" data-action="rotate" data-id="${esc(robot.id)}">Gerar novo token</button><button class="text-button danger" data-action="delete" data-id="${esc(robot.id)}">Remover robô</button></div></details>`;
}
function renderAccount() {
  if (!me) { el('account-panel').innerHTML = authPanel(); return; }
  el('account-panel').innerHTML = `<div class="account-heading"><h3>O cantinho de ${esc(me.account.displayName)}</h3><button class="text-button" data-action="logout">Sair</button></div><details class="my-desk"><summary>Minha mesa e meus robôs</summary><form data-form="desk"><label>Tamanho da mesa<select name="deskSize">${Object.entries(sizeLabels).map(([value, label]) => `<option value="${value}" ${me!.account.deskSize === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="quiet" type="submit">Salvar mesa</button></form><div class="own-robots">${me.robots.map(robotEditor).join('')}</div><details class="new-robot"><summary>+ Adicionar robô / chat</summary><form data-form="robot-create"><label>Provedor<select name="provider"><option value="codex">Codex</option><option value="cursor">Cursor</option><option value="claude">Claude Code</option></select></label><label>Nome do robô<input name="label" maxlength="32" required placeholder="Codex 1"></label><label>ID privado da sessão<input name="sessionId" maxlength="128" required autocomplete="off"></label><p class="small-help">Use o ID do chat que seu coletor envia. Ele fica só com você.</p><button class="primary" type="submit" ${me.robots.length >= 12 ? 'disabled' : ''}>Criar robô</button></form></details>${lastToken ? `<div class="token-note"><h4>Guarde o token deste robô</h4><p>Ele aparece só agora. Configure no seu coletor e mantenha em segredo.</p><textarea aria-label="Token do coletor" readonly rows="3" spellcheck="false">${esc(lastToken.token)}</textarea><button class="quiet" data-action="hide-token">Já guardei · ocultar</button></div>` : ''}<p class="small-help">Até 12 chats. Criar um robô não conecta a sua conta: o coletor precisa enviar seus sinais.</p></details>`;
  if (lastToken) el('account-panel').querySelector<HTMLDetailsElement>('.my-desk')!.open = true;
}
async function loadDemo() { const next = await api<Snapshot>(`/api/demo?step=${step}`); if (!simulated) return; snapshot = next; if (!selection || !snapshot.robots.some(r => r.id === selection!.id)) selection = { kind: 'robot', id: snapshot.robots[0].id }; renderScene(); }
async function loadReal(configuration = false) {
  simulated = false;
  if (configuration) me = await api<Me>('/api/me');
  const next = await api<Snapshot>('/api/village'); if (simulated) return; snapshot = next;
  if (selection && !snapshot.robots.some(r => r.id === selection!.id) && !snapshot.members.some(m => m.id === selection!.id)) selection = null;
  renderScene(); if (configuration) renderAccount();
}
async function advance() { if (step >= (snapshot?.totalSteps ?? 20)) { playing = false; return; } step++; await loadDemo(); }
async function play() { if (!playing) return; await advance(); if (step < (snapshot?.totalSteps ?? 20) && playing) timer = setTimeout(() => { void play().catch(handleError); }, 900); else { playing = false; renderScene(); } }
function stopDemo() { playing = false; clearTimeout(timer); }
const handleError = (error: unknown) => notify(error instanceof Error ? error.message : 'Não foi possível conectar. Tente novamente.', true);

app.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]'); if (!button) return;
  const action = button.dataset.action;
  void (async () => {
    if (action === 'view') setView(button.dataset.view as typeof view);
    if (action === 'select-member' || action === 'select-robot') { select({ kind: action === 'select-member' ? 'member' : 'robot', id: button.dataset.id! }); if (action === 'select-robot') setView('office'); }
    if (action === 'auth-mode') { authMode = authMode === 'login' ? 'register' : 'login'; renderAccount(); }
    if (action === 'next') await advance();
    if (action === 'play') { if (playing) { stopDemo(); renderScene(); } else { if (step === snapshot?.totalSteps) step = 0; playing = true; await play(); } }
    if (action === 'mode') { stopDemo(); simulated = !simulated; selection = null; if (simulated) { step = 0; await loadDemo(); } else await loadReal(true); }
    if (action === 'logout') { await api('/api/auth/logout', 'POST', {}); me = null; lastToken = null; simulated = true; selection = null; stopDemo(); step = 0; await loadDemo(); renderAccount(); notify('Você saiu. Os robôs continuam recebendo sinais dos coletores.'); }
    if (action === 'rotate') { const result = await api<{ token: string }>(`/api/robots/${button.dataset.id}/token`, 'POST', {}); lastToken = { id: button.dataset.id!, token: result.token }; renderAccount(); notify('Novo token gerado. O anterior foi revogado.'); }
    if (action === 'delete') { await api(`/api/robots/${button.dataset.id}`, 'DELETE', {}); if (lastToken?.id === button.dataset.id) lastToken = null; await loadReal(true); notify('Robô removido e token revogado.'); }
    if (action === 'hide-token') { lastToken = null; renderAccount(); }
  })().catch(handleError);
});
app.addEventListener('submit', event => {
  const form = event.target as HTMLFormElement; if (!form.dataset.form) return; event.preventDefault();
  const data = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, String(value)]));
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!; submit.disabled = true;
  void (async () => {
    if (form.dataset.form === 'auth') { await api(`/api/auth/${authMode}`, 'POST', data); me = await api<Me>('/api/me'); simulated = false; selection = { kind: 'member', id: me.account.id }; stopDemo(); await loadReal(true); setView('office'); notify('Seu cantinho está pronto. Bem-vindo à vila.'); }
    if (form.dataset.form === 'desk') { await api('/api/desk', 'PATCH', data); await loadReal(true); notify('Mesa salva.'); }
    if (form.dataset.form === 'robot-create') { const result = await api<{ robot: OwnRobot; token: string }>('/api/robots', 'POST', data); lastToken = { id: result.robot.id, token: result.token }; simulated = false; selection = { kind: 'robot', id: result.robot.id }; await loadReal(true); setView('office'); notify('Robô criado. Guarde seu token para conectar o coletor.'); }
    if (form.dataset.form === 'robot-edit') { await api(`/api/robots/${form.dataset.id}`, 'PATCH', data); simulated = false; await loadReal(true); notify('Compartilhamento salvo.'); }
  })().catch(handleError).finally(() => { submit.disabled = false; });
});
try { world = new VillageWorld(el('stage'), select, () => setView('office')); } catch { el('stage').insertAdjacentHTML('afterbegin', '<div class="webgl-fallback"><span aria-hidden="true">⌂</span><h2>A vila continua por aqui.</h2><p>O cenário 3D precisa de WebGL. Use o caderninho ao lado para escolher mesas, acompanhar robôs e configurar seu cantinho.</p></div>'); }
void (async () => {
  try { me = await api<Me>('/api/me'); simulated = false; } catch { me = null; }
  if (me) await loadReal(); else await loadDemo(); renderAccount();
})().catch(handleError);
const poll = setInterval(() => {
  if (!me || simulated || polling) return;
  polling = true; void loadReal().catch(handleError).finally(() => { polling = false; });
}, 3000);
window.addEventListener('pagehide', () => { stopDemo(); clearInterval(poll); world?.dispose(); lastToken = null; });
