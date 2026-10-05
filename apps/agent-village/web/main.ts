import './styles.css';
import { VillageWorld, type Selection } from './world';
import { statusLabels, sizeLabels, type Snapshot, type Me, type OwnConnection, type Pairing, type Shell, type ConnectorProvider, type Privacy } from './types';

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
let pairing: Pairing | null = null;
let polling = false;

const providerLabels: Record<ConnectorProvider, string> = { codex: 'Codex', claude: 'Claude Code' };
const shellLabels: Record<Shell, string> = { powershell: 'PowerShell', 'git-bash': 'Git Bash', zsh: 'zsh' };
const privacyLabels: Record<Privacy, string> = { none: 'Não compartilhar · só estado', title: 'Compartilhar título', description: 'Compartilhar título e descrição' };
const connectionList = () => me?.connections ?? [];
const robotsFor = (connection: OwnConnection) => me?.robots.filter(robot => robot.connectionId === connection.id) ?? [];
const connectionPrivacy = (connection: OwnConnection): Privacy => connection.defaultPrivacy ?? connection.privacy ?? 'none';

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
  const onboarding = view === 'office' && !me;
  el('scene-note').textContent = onboarding ? 'Abra sua conta para entrar nesta mesa.' : view === 'village' ? 'O escritório fica no centro da vila.' : 'Cada mesa tem um dono. Cada robô tem um chat.';
  if (snapshot) renderScene();
  if (!me) {
    renderAccount();
    if (onboarding) requestAnimationFrame(() => el('account-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
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
  const connection = robot.connectionLabel ?? connectionList().find(candidate => candidate.id === robot.connectionId)?.label;
  const parent = robot.parentId ? ' · agente filho' : '';
  el('selection').innerHTML = `<p class="eyebrow">${esc(member.displayName)} · ${esc(connection ?? providerLabels[robot.provider as ConnectorProvider] ?? robot.provider)}</p><div class="robot-heading"><h3>${esc(robot.label)}</h3><span class="status-dot status-${esc(robot.status)}" aria-hidden="true"></span></div><p class="activity">${statusLabels[robot.status] ?? 'Sem sinal'}${parent}</p>${shared}<p class="signal-time">${esc(signal)}</p>`;
}
function renderRoster() {
  if (!snapshot) return;
  el('roster-count').textContent = String(snapshot.members.length);
  el('roster').innerHTML = snapshot.members.map(member => {
    const bots = snapshot!.robots.filter(r => r.ownerId === member.id);
    const groups = new Map<string, { label: string; provider: string; robots: typeof bots }>();
    bots.forEach(robot => {
      const key = robot.connectionId ?? `legacy:${robot.provider}`;
      const label = robot.connectionLabel ?? connectionList().find(connection => connection.id === robot.connectionId)?.label ?? providerLabels[robot.provider as ConnectorProvider] ?? robot.provider;
      const group = groups.get(key) ?? { label, provider: providerLabels[robot.provider as ConnectorProvider] ?? robot.provider, robots: [] };
      group.robots.push(robot); groups.set(key, group);
    });
    const grouped = [...groups.values()].map(group => `<div class="connection-group"><p class="connection-group-label"><span>${esc(group.label)}</span><small>${esc(group.provider)} · ${group.robots.length} ${group.robots.length === 1 ? 'robô' : 'robôs'}</small></p>${group.robots.map(robot => `<button data-action="select-robot" data-id="${esc(robot.id)}" aria-pressed="${selection?.kind === 'robot' && selection.id === robot.id}"><span class="bot-symbol" aria-hidden="true">▣</span><span>${esc(robot.label)}<small>${statusLabels[robot.status] ?? 'Sem sinal'}${robot.parentId ? ' · filho de outro agente' : ''}</small></span><span class="status-dot status-${esc(robot.status)}" aria-hidden="true"></span></button>`).join('')}</div>`).join('');
    return `<div class="resident"><button class="resident-name" data-action="select-member" data-id="${esc(member.id)}" aria-pressed="${selection?.kind === 'member' && selection.id === member.id}"><span class="presence ${member.online ? 'online' : ''}" aria-hidden="true"></span>${esc(member.displayName)}<span>${member.online ? 'por aqui' : 'offline'}</span></button><div class="robot-list">${grouped || '<p class="empty-roster">Nenhum agente nasceu ainda. O cantinho já está reservado.</p>'}</div></div>`;
  }).join('');
}
function renderScene() {
  if (!snapshot) return;
  const active = snapshot.robots.filter(r => ['working', 'reading', 'tool', 'waiting'].includes(r.status)).length;
  const onboarding = view === 'office' && !me;
  el('world-count').textContent = `${snapshot.members.length} moradores · ${snapshot.robots.length} chats · ${active} em atividade`;
  el('mode-label').textContent = onboarding ? 'Conecte seu agente' : simulated ? 'Demonstração simulada' : 'Nossa vila';
  el('demo-controls').hidden = !simulated || onboarding;
  el('honest-note').textContent = onboarding ? 'Esta é uma prévia da vila. Entre ou crie sua conta para abrir sua mesa e conectar Codex ou Claude.' : simulated ? 'Pessoas e eventos fictícios. Esta demonstração não acompanha nenhuma conta real.' : 'Os estados são o último sinal recebido. Conecte um coletor próprio para enviar eventos dos seus chats.';
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
  const onboarding = view === 'office';
  const title = onboarding ? (creating ? 'Reserve seu cantinho real' : 'Abra seu escritório real') : creating ? 'Reserve seu cantinho' : 'Entre na nossa vila';
  const description = onboarding ? 'Entre ou crie uma conta para sair da demonstração e conectar seu Codex ou Claude.' : 'Sua conta é só desta vila. Peça o convite a quem chamou a turma.';
  return `${onboarding ? '<div class="onboarding-callout"><p class="eyebrow">Onboarding da vila</p><strong>Conecte seu agente de verdade</strong><p class="muted">A demonstração fica aqui só como prévia. Sua mesa real começa depois do acesso.</p></div>' : ''}<h3>${title}</h3><p class="muted">${description}</p><form data-form="auth"><label>Nome de acesso<input name="username" autocomplete="username" minlength="3" maxlength="24" pattern="[a-z0-9_-]+" required placeholder="ex.: renatin"></label>${creating ? '<label>Como a turma te chama<input name="displayName" maxlength="32" required autocomplete="nickname"></label>' : ''}<label>Senha<input name="password" type="password" autocomplete="${creating ? 'new-password' : 'current-password'}" minlength="${creating ? 10 : 1}" maxlength="128" required></label>${creating ? '<label>Código de convite<input name="inviteCode" type="password" required autocomplete="off"></label>' : ''}<button class="primary" type="submit">${creating ? 'Criar meu cantinho' : 'Entrar'}</button></form><button class="text-button" data-action="auth-mode">${creating ? 'Já tenho conta' : 'Quero criar meu cantinho'}</button>`;
}
function installCommand(current: Pairing) {
  const base = window.location.origin;
  if (current.shell === 'powershell') return `$p = Join-Path $env:TEMP "vila-agentes.ps1"; iwr ${base}/install.ps1 -OutFile $p; & $p -PairingCode ${current.code}; Remove-Item $p`;
  const runner = current.shell === 'zsh' ? 'zsh' : 'bash';
  return `curl -fsSL ${base}/install.sh | ${runner} -s -- --pairing-code ${current.code}`;
}
function pairingStatus() {
  if (!pairing) return '';
  const connection = connectionList().find(candidate => candidate.id === pairing!.connectionId);
  const robots = pairing.connectionId ? me?.robots.filter(robot => robot.connectionId === pairing!.connectionId) ?? [] : pairing.robotId ? me?.robots.filter(robot => robot.id === pairing!.robotId) ?? [] : [];
  if (!connection && !pairing.robotId) return 'Aguardando a execução do comando de instalação.';
  if (!connection && robots.every(robot => robot.status === 'pending')) return 'Aguardando a execução do comando de instalação.';
  if (!robots.length) return 'Conexão instalada. Abra o agente e faça uma ação para o primeiro robô nascer.';
  return `${robots.length} ${robots.length === 1 ? 'robô descoberto' : 'robôs descobertos'} · ${statusLabels[robots.at(-1)?.status ?? 'idle'] ?? 'sinal recebido'}`;
}
function pairingWizard() {
  if (!pairing) return `<details class="new-connection"><summary>+ Conectar um harness</summary><form data-form="connection-create"><label>Provedor<select name="provider"><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label><label>Nome da conexão<input name="label" maxlength="32" required placeholder="Meu Codex local"></label><label>Privacidade padrão<select name="defaultPrivacy">${Object.entries(privacyLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>Seu terminal<select name="shell"><option value="powershell">PowerShell</option><option value="git-bash">Git Bash</option><option value="zsh">zsh</option></select></label><p class="small-help">Uma conexão observa esse harness. Cada chat ou agent filho que emitir sinais nasce como um robô automaticamente.</p><button class="primary" type="submit">Gerar comando de pareamento</button></form></details>`;
  const remaining = Math.max(0, pairing.expiresAt - Date.now());
  const shell = pairing.shell ?? 'powershell';
  return `<section class="pairing-wizard"><div class="pairing-heading"><div><p class="eyebrow">Pareando ${esc(providerLabels[pairing.provider])}</p><h4>${esc(pairing.label)}</h4></div><button class="text-button" data-action="cancel-pairing">Cancelar</button></div><div class="shell-tabs" role="group" aria-label="Terminal">${(Object.keys(shellLabels) as Shell[]).map(candidate => `<button type="button" data-action="shell" data-shell="${candidate}" aria-pressed="${shell === candidate}">${shellLabels[candidate]}</button>`).join('')}</div><p class="pairing-code-label">Código temporário · expira em ${Math.ceil(remaining / 60000)} min</p><code class="pairing-code">${esc(pairing.code)}</code><label class="command-label">Comando para ${shellLabels[shell]}<textarea readonly rows="3" aria-label="Comando de instalação">${esc(installCommand({ ...pairing, shell }))}</textarea></label><button class="primary" data-action="copy-command">Copiar comando</button><p class="pairing-status" role="status">${esc(pairingStatus())}</p><p class="small-help">Depois de executar, abra ${esc(providerLabels[pairing.provider])} e faça uma ação. Cada sessão detectada ganhará seu próprio robô.</p></section>`;
}
function connectionEditor(connection: OwnConnection) {
  const robots = robotsFor(connection);
  const status = connection.installed === false ? 'Aguardando instalação' : robots.length ? `${robots.length} ${robots.length === 1 ? 'robô descoberto' : 'robôs descobertos'}` : 'Conectado · aguardando o primeiro sinal';
  return `<details class="connection-editor" data-connection-id="${esc(connection.id)}"><summary>${esc(connection.label)} <span>${esc(providerLabels[connection.provider])} · ${status}</span></summary><form data-form="connection-edit" data-id="${esc(connection.id)}"><label>Nome da conexão<input name="label" value="${esc(connection.label)}" maxlength="32" required></label><label>Privacidade padrão<select name="defaultPrivacy">${Object.entries(privacyLabels).map(([value, label]) => `<option value="${value}" ${connectionPrivacy(connection) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><p class="small-help">Novos robôs herdam esta escolha. Um robô que já nasceu mantém sua própria privacidade.</p><button class="primary" type="submit">Salvar conexão</button></form><div class="connection-sessions">${robots.length ? robots.map(robot => `<p><span class="status-dot status-${esc(robot.status)}" aria-hidden="true"></span><strong>${esc(robot.label)}</strong><small>${statusLabels[robot.status] ?? 'Sem sinal'}${robot.parentId ? ' · agente filho' : ''}</small></p>`).join('') : '<p class="small-help">Nenhum chat emitiu sinal ainda. Quando isso acontecer, o robô aparecerá aqui.</p>'}</div><div class="robot-actions"><button class="quiet" data-action="rotate-connection" data-id="${esc(connection.id)}">Gerar novo token</button><button class="text-button danger" data-action="delete-connection" data-id="${esc(connection.id)}">Revogar conexão</button></div></details>`;
}
function renderAccount() {
  if (!me) {
    const panel = el('account-panel');
    panel.classList.toggle('is-onboarding', view === 'office');
    panel.innerHTML = authPanel();
    return;
  }
  el('account-panel').classList.remove('is-onboarding');
  const connections = connectionList();
  const openDetails = new Set([...el('account-panel').querySelectorAll<HTMLElement>('details[open]')].map(detail => detail.dataset.connectionId ?? detail.className));
  el('account-panel').innerHTML = `<div class="account-heading"><h3>O cantinho de ${esc(me.account.displayName)}</h3><button class="text-button" data-action="logout">Sair</button></div><details class="my-desk"><summary>Minha mesa e conexões</summary><form data-form="desk"><label>Tamanho da mesa<select name="deskSize">${Object.entries(sizeLabels).map(([value, label]) => `<option value="${value}" ${me!.account.deskSize === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="quiet" type="submit">Salvar mesa</button></form><p class="small-help connection-intro">Crie uma conexão para cada instalação de Codex ou Claude. Os robôs nascem automaticamente por sessão; não é preciso cadastrar título ou descrição.</p><div class="own-connections">${connections.map(connectionEditor).join('') || '<p class="small-help">Nenhuma conexão ainda. O primeiro passo é conectar um harness.</p>'}</div>${pairingWizard()}${lastToken ? `<div class="token-note"><h4>Guarde o token desta conexão</h4><p>Ele aparece só agora. Configure no seu coletor e mantenha em segredo.</p><textarea aria-label="Token do coletor" readonly rows="3" spellcheck="false">${esc(lastToken.token)}</textarea><button class="quiet" data-action="hide-token">Já guardei · ocultar</button></div>` : ''}<p class="small-help">Cada conexão pode observar vários chats e agents filhos. Tokens são revogáveis e nunca aparecem para outros moradores.</p></details>`;
  if (lastToken || pairing || openDetails.has('my-desk')) el('account-panel').querySelector<HTMLDetailsElement>('.my-desk')!.open = true;
  for (const detail of el('account-panel').querySelectorAll<HTMLDetailsElement>('[data-connection-id]')) if (openDetails.has(detail.dataset.connectionId!)) detail.open = true;
}
async function loadDemo() { const next = await api<Snapshot>(`/api/demo?step=${step}`); if (!simulated) return; snapshot = next; if (!selection || !snapshot.robots.some(r => r.id === selection!.id)) selection = { kind: 'robot', id: snapshot.robots[0].id }; renderScene(); }
async function loadReal(configuration = false) {
  simulated = false;
  if (configuration || pairing) me = await api<Me>('/api/me');
  const next = await api<Snapshot>('/api/village'); if (simulated) return;
  // The public snapshot intentionally omits connection/session identifiers.
  // Merge those safe-for-owner fields locally so the owner's roster can group
  // sessions by connection without exposing private metadata to other viewers.
  const ownRobots = new Map((me?.robots ?? []).map(robot => [robot.id, robot]));
  snapshot = { ...next, robots: next.robots.map(robot => {
    const own = ownRobots.get(robot.id);
    if (!own) return robot;
    const connection = connectionList().find(candidate => candidate.id === own.connectionId);
    return { ...robot, connectionId: own.connectionId, connectionLabel: connection?.label, parentId: own.parentRobotId ?? null };
  }) };
  if (selection && !snapshot.robots.some(r => r.id === selection!.id) && !snapshot.members.some(m => m.id === selection!.id)) selection = null;
  renderScene(); if (configuration || pairing) renderAccount();
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
    if (action === 'logout') { await api('/api/auth/logout', 'POST', {}); me = null; lastToken = null; pairing = null; simulated = true; selection = null; stopDemo(); step = 0; await loadDemo(); renderAccount(); notify('Você saiu. Os robôs continuam recebendo sinais dos coletores.'); }
    if (action === 'shell' && pairing) { pairing.shell = button.dataset.shell as Shell; renderAccount(); }
    if (action === 'copy-command' && pairing) { const command = installCommand(pairing); try { await navigator.clipboard.writeText(command); notify('Comando copiado. Cole no terminal escolhido.'); } catch { const input = document.createElement('textarea'); input.value = command; document.body.append(input); input.select(); document.execCommand('copy'); input.remove(); notify('Comando copiado. Cole no terminal escolhido.'); } }
    if (action === 'cancel-pairing' && pairing) { const path = pairing.connectionId ? `/api/connections/${pairing.connectionId}` : pairing.robotId ? `/api/robots/${pairing.robotId}` : ''; if (path) await api(path, 'DELETE', {}); pairing = null; await loadReal(true); notify('Pareamento cancelado.'); }
    if (action === 'rotate-connection') { const result = await api<{ token: string }>(`/api/connections/${button.dataset.id}/token`, 'POST', {}); lastToken = { id: button.dataset.id!, token: result.token }; renderAccount(); notify('Novo token gerado. O anterior foi revogado.'); }
    if (action === 'delete-connection') { await api(`/api/connections/${button.dataset.id}`, 'DELETE', {}); if (lastToken?.id === button.dataset.id) lastToken = null; if (pairing?.connectionId === button.dataset.id) pairing = null; await loadReal(true); notify('Conexão revogada. Os robôs permanecem como último estado conhecido.'); }
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
    if (form.dataset.form === 'connection-create') { const result = await api<{ pairing: Pairing; connection?: OwnConnection }>('/api/pairings', 'POST', { provider: data.provider, label: data.label, defaultPrivacy: data.defaultPrivacy }); pairing = { ...result.pairing, connectionId: result.pairing.connectionId ?? result.connection?.id, shell: data.shell as Shell }; simulated = false; await loadReal(true); setView('office'); notify('Conexão criada. Copie o comando no seu terminal; os robôs nascerão pelas sessões.'); }
    if (form.dataset.form === 'connection-edit') { await api(`/api/connections/${form.dataset.id}`, 'PATCH', { label: data.label, defaultPrivacy: data.defaultPrivacy }); simulated = false; await loadReal(true); notify('Conexão salva.'); }
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
