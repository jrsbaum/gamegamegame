import * as THREE from 'three';
import type { Snapshot } from './types';

// Geometry and palette adapted from the user's local eventos-na-vila prototype.
const palette = { grass: '#86b765', edge: '#629254', wood: '#c99354', lightwood: '#e3bd83', cream: '#f7eaca', roof: '#638a9a', green: '#52764c', leaf: '#6da951', skin: '#e3b78d', hair: '#664838', blue: '#578c9b', coral: '#d18669', gold: '#d0ad58', ink: '#314c45', screen: '#95d1c1', metal: '#e5e8d2' };
const colors = [palette.blue, palette.coral, palette.green, palette.gold];
const activity: Record<string, string> = { idle: '#9aa497', working: '#70bacc', reading: '#9b9acb', tool: '#65bcbc', waiting: '#e0aa46', completed: '#85bb56', error: '#d16d5f', interrupted: '#a9a099', offline: '#8e978e' };
export type Selection = { kind: 'robot' | 'member'; id: string } | null;

export class VillageWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-10, 10, 8, -8, .1, 250);
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private terrain = new THREE.Group();
  private desks = new THREE.Group();
  private roof = new THREE.Group();
  private bots = new Map<string, THREE.Group>();
  private selectionRing: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private observer: ResizeObserver;
  private motion = matchMedia('(prefers-reduced-motion: reduce)');
  private view: 'village' | 'office' = 'village';
  private signature = '';
  private roomWidth = 18;
  private roomDepth = 13;
  private centerZ = 0;
  private previous = 0;

  constructor(private stage: HTMLElement, private onSelect: (selection: Selection) => void, private onEnter: () => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#bbdcb5');
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.stage.prepend(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#fff3cf', '#83a073', 2.5));
    const sun = new THREE.DirectionalLight('#fff1c6', 3.1);
    sun.position.set(-6, 14, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 });
    sun.shadow.normalBias = .045; this.scene.add(sun);
    this.camera.position.set(20, 25, 30); this.camera.lookAt(0, 0, 0);
    this.scene.add(this.terrain, this.desks, this.roof);
    this.selectionRing = new THREE.Mesh(new THREE.RingGeometry(.7, .8, 48), new THREE.MeshBasicMaterial({ color: '#f5d374', side: THREE.DoubleSide }));
    this.selectionRing.rotation.x = -Math.PI / 2; this.selectionRing.visible = false; this.scene.add(this.selectionRing);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(stage);
    this.renderer.domElement.addEventListener('click', this.pick);
    this.motion.addEventListener('change', this.configureMotion);
    this.configureMotion();
  }
  private mat(color: string) {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .85, flatShading: true }));
    return this.materials.get(color)!;
  }
  private mesh(p: THREE.Object3D, geometry: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(geometry, this.mat(color)); object.position.set(x, y, z); object.castShadow = true; object.receiveShadow = true; p.add(object); return object;
  }
  private box(p: THREE.Object3D, w: number, h: number, d: number, c: string, x = 0, y = 0, z = 0) { return this.mesh(p, new THREE.BoxGeometry(w, h, d), c, x, y, z); }
  private ball(p: THREE.Object3D, r: number, c: string, x = 0, y = 0, z = 0) { return this.mesh(p, new THREE.IcosahedronGeometry(r, 1), c, x, y, z); }
  private cyl(p: THREE.Object3D, r: number, h: number, c: string, x = 0, y = 0, z = 0, r2 = r) { return this.mesh(p, new THREE.CylinderGeometry(r, r2, h, 12), c, x, y, z); }
  private group(p: THREE.Object3D, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; }
  private rounded(p: THREE.Object3D, w: number, h: number, d: number, c: string, x = 0, y = 0, z = 0, r = .16) {
    const s = new THREE.Shape(), a = -w / 2, b = -d / 2;
    s.moveTo(a + r, b); s.lineTo(a + w - r, b); s.quadraticCurveTo(a + w, b, a + w, b + r); s.lineTo(a + w, b + d - r); s.quadraticCurveTo(a + w, b + d, a + w - r, b + d); s.lineTo(a + r, b + d); s.quadraticCurveTo(a, b + d, a, b + d - r); s.lineTo(a, b + r); s.quadraticCurveTo(a, b, a + r, b);
    const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .035, bevelThickness: .035, curveSegments: 5 }); geo.rotateX(-Math.PI / 2); return this.mesh(p, geo, c, x, y - h / 2, z);
  }
  private plant(p: THREE.Object3D, x: number, z: number, scale = 1) {
    const g = this.group(p, x, 0, z); g.scale.setScalar(scale); this.cyl(g, .22, .34, palette.coral, 0, .17); this.cyl(g, .018, .65, palette.green, 0, .65);
    for (let i = 0; i < 5; i++) { const a = i * 2.4; this.ball(g, .18, palette.leaf, Math.cos(a) * .17, .63 + i * .065, Math.sin(a) * .17).scale.set(1, .45, .65); } return g;
  }
  private tree(p: THREE.Object3D, x: number, z: number, scale = 1) {
    const g = this.group(p, x, 0, z); g.scale.setScalar(scale); this.cyl(g, .13, 1.8, palette.hair, 0, .9); this.ball(g, .87, palette.leaf, 0, 2); this.ball(g, .63, palette.grass, -.52, 1.82, .05); this.ball(g, .65, palette.green, .47, 1.78, .1);
  }
  private human(p: THREE.Object3D, color: string) {
    const g = this.group(p, 0, .38, 1.75); g.rotation.y = Math.PI;
    this.cyl(g, .27, .52, color, 0, .49, 0, .24); this.ball(g, .32, palette.skin, 0, 1.02); this.ball(g, .325, palette.hair, 0, 1.11, -.06); this.rounded(g, .42, .25, .21, palette.skin, 0, 1.01, .19, .08);
    for (const side of [-1, 1]) { this.box(g, .045, .06, .028, palette.ink, side * .11, 1.045, .31); this.cyl(g, .09, .36, palette.skin, side * .32, .49, .08); this.box(g, .16, .25, .28, palette.ink, side * .13, .11, .08); } return g;
  }
  private robot(p: THREE.Object3D, x: number, z: number, color: string, index: number, id: string) {
    const g = this.group(p, x, .38, z); this.rounded(g, .43, .37, .35, color, 0, .37, 0, .1); this.rounded(g, .56, .38, .4, palette.metal, 0, .77, 0, .13); this.rounded(g, .41, .19, .025, palette.ink, 0, .78, .225, .045);
    const eyes: THREE.Mesh[] = [];
    for (const side of [-1, 1]) { const eye = this.ball(g, .04, palette.screen, side * .1, .8, .25); eye.material = eye.material.clone(); eyes.push(eye); this.cyl(g, .055, .21, color, side * .29, .4, .02); this.box(g, .13, .08, .2, palette.ink, side * .12, .095, .07); }
    this.cyl(g, .017, .16, palette.ink, 0, 1.03); const light = this.ball(g, .055, color, 0, 1.13); light.material = light.material.clone(); g.userData = { kind: 'robot', id, index, eyes, light, status: 'idle' }; this.bots.set(id, g); return g;
  }
  private chair(p: THREE.Object3D, x: number, z: number, c: string) { this.cyl(p, .32, .1, c, x, .43, z); this.cyl(p, .045, .35, palette.hair, x, .2, z); this.box(p, .53, .48, .09, c, x, .68, z + .25); }
  private monitor(p: THREE.Object3D, x: number, z: number, rotation = 0, mini = false) {
    const g = this.group(p, x, .93, z); g.rotation.y = rotation; g.scale.setScalar(mini ? .55 : 1);
    this.rounded(g, .64, .43, .09, palette.ink, 0, .34, 0, .065); this.box(g, .53, .32, .012, palette.screen, 0, .35, .058); this.cyl(g, .035, .2, palette.hair, 0, .08); this.rounded(g, .33, .04, .2, palette.ink); for (let i = 0; i < 3; i++) this.box(g, .32 - i * .055, .014, .014, palette.cream, -.035, .41 - i * .08, .072); this.rounded(g, .5, .035, .16, palette.cream, 0, -.015, .3, .025);
  }
  private label(text: string, p: THREE.Object3D, x: number, y: number, z: number, width = 2.5) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff8e5'; ctx.beginPath(); ctx.roundRect(4, 4, 504, 120, 32); ctx.fill(); ctx.fillStyle = palette.ink; ctx.font = 'bold 56px Trebuchet MS, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text.slice(0, 24), 256, 65, 450);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false })); sprite.position.set(x, y, z); sprite.scale.set(width, width / 4, 1); p.add(sprite); return sprite;
  }
  private release(parent: THREE.Object3D) {
    parent.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (o.userData.uniqueMaterial) (o.material as THREE.Material).dispose(); } if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); } if (o.userData.eyes) { o.userData.eyes.forEach((eye: THREE.Mesh) => (eye.material as THREE.Material).dispose()); (o.userData.light.material as THREE.Material).dispose(); } }); parent.clear();
  }
  setSnapshot(snapshot: Snapshot) {
    const signature = JSON.stringify([snapshot.members.map(m => [m.id, m.displayName, m.deskSize]), snapshot.robots.map(r => [r.id, r.ownerId, r.label, r.provider])]);
    if (signature !== this.signature) {
      this.signature = signature; this.release(this.terrain); this.release(this.desks); this.release(this.roof); this.bots.clear();
      const columns = Math.min(3, Math.max(1, snapshot.members.length)), rows = Math.max(1, Math.ceil(snapshot.members.length / columns));
      this.roomWidth = Math.max(12, columns * 6.5 + 2); this.roomDepth = Math.max(9, rows * 7.5 + 2); this.centerZ = 0;
      const w = this.roomWidth, d = this.roomDepth;
      this.rounded(this.terrain, w + 12, .6, d + 12, palette.edge, 0, -.34, 0, 1.4); this.rounded(this.terrain, w + 11.7, .13, d + 11.7, palette.grass, 0, -.03, 0, 1.3);
      this.rounded(this.terrain, w, .16, d, palette.wood, 0, .06, 0, .25);
      for (let x = -w / 2 + .3; x < w / 2; x += .5) this.box(this.terrain, .018, .006, d - .2, '#ae7e45', x, .148);
      this.box(this.terrain, w, .9, .2, palette.cream, 0, .59, -d / 2); this.box(this.terrain, .2, .9, d, palette.cream, -w / 2, .59);
      for (const x of [-w / 2, 0, w / 2]) { this.box(this.terrain, .15, 2.7, .18, palette.wood, x, 1.49, -d / 2); this.box(this.terrain, 2.9, 1.3, .04, '#bce1d0', x * .7, 1.74, -d / 2 - .02); }
      this.box(this.terrain, w, .18, .2, palette.wood, 0, 2.8, -d / 2);
      const left = this.box(this.roof, w / 2 + .6, .18, d + .6, palette.roof, -w / 4, 3.8); left.rotation.z = .2;
      const right = this.box(this.roof, w / 2 + .6, .18, d + .6, palette.roof, w / 4, 3.8); right.rotation.z = -.2;
      const entry = this.group(this.terrain, 0, 0, d / 2 + .15); entry.userData = { kind: 'entry' }; this.rounded(entry, 3.1, .12, 1.3, palette.lightwood); this.label('Escritório · entrar', entry, 0, 1.7, .5, 3.6);
      for (const [x, z, scale] of [[-w / 2 - 3, -d / 2, 1.25], [-w / 2 - 4, 2, 1], [-w / 2 - 3, d / 2 + 3, 1.1], [w / 2 + 3, d / 2 + 2, 1.2], [w / 2 + 3, -d / 2 - 1, 1.25], [-4, -d / 2 - 3, .9], [3, -d / 2 - 3, .85]]) this.tree(this.terrain, x, z, scale);
      this.rounded(this.terrain, 3.1, .025, 2.1, '#75b7ba', w / 2 + 3.5, 0, 1.5, .6);
      for (let row = 0; row < 3; row++) { this.rounded(this.terrain, 3.5, .08, .4, palette.hair, -4, .025, d / 2 + 2 + row * .6, .1); for (let i = 0; i < 8; i++) this.ball(this.terrain, .16, palette.green, -5.5 + i * .44, .18, d / 2 + 2 + row * .6); }
      snapshot.members.forEach((member, index) => {
        const desk = this.group(this.desks, (index % columns - (columns - 1) / 2) * 6.5, .17, (Math.floor(index / columns) - (rows - 1) / 2) * 7.5); desk.userData = { kind: 'member', id: member.id };
        const width = { small: 2.7, medium: 3.7, large: 4.7 }[member.deskSize], color = colors[index % colors.length];
        this.rounded(desk, width + .9, .055, 5.8, '#d7d8a8', 0, .065, -.5, .3); this.rounded(desk, width, .18, 1.85, palette.lightwood, 0, .88, 0, .24);
        for (const x of [-width / 2 + .3, width / 2 - .3]) for (const z of [-.7, .7]) this.cyl(desk, .075, .7, palette.wood, x, .4, z);
        this.chair(desk, 0, 1.75, color); this.human(desk, color); this.monitor(desk, 0, .54); this.plant(desk, width / 2 - .4, .5, .7).position.y = .95;
        this.label(member.displayName, desk, 0, 2.55, 2.4, 3);
        const owned = snapshot.robots.filter(r => r.ownerId === member.id);
        owned.forEach((robot, i) => { const rowCount = Math.min(4, owned.length - Math.floor(i / 4) * 4), x = (i % 4 - (rowCount - 1) / 2) * .9, z = -1.5 - Math.floor(i / 4) * 1.15; this.chair(desk, x, z, color); this.robot(desk, x, z, color, i, robot.id); this.monitor(desk, x, -.65, Math.PI, true); if (owned.length <= 4) this.label(robot.label, desk, x, 1.95, z, 1.6); });
      });
      this.setView(this.view);
    }
    for (const robot of snapshot.robots) {
      const g = this.bots.get(robot.id); if (!g) continue;
      g.userData.status = robot.status;
      (g.userData.light.material as THREE.MeshStandardMaterial).color.set(activity[robot.status] ?? activity.idle);
      g.userData.eyes.forEach((eye: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>) => { eye.material.color.set(activity[robot.status] ?? activity.idle); eye.scale.y = robot.status === 'idle' ? .25 : 1; });
    }
    this.render();
  }
  setView(view: 'village' | 'office') {
    this.view = view; this.roof.visible = view === 'village';
    this.desks.traverse(o => { if (o instanceof THREE.Sprite) o.visible = view === 'office'; });
    this.resize();
  }
  select(selection: Selection) {
    this.selectionRing.visible = false;
    if (selection) this.desks.traverse(o => { if (o.userData.kind === selection.kind && o.userData.id === selection.id) { o.getWorldPosition(this.selectionRing.position); this.selectionRing.position.y = .27; this.selectionRing.visible = true; } });
    this.render();
  }
  private resize() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight; if (!w || !h) return;
    const aspect = w / h, extra = this.view === 'village' ? 12 : 1;
    const span = Math.max(this.roomDepth * .8 + extra, (this.roomWidth + this.roomDepth * .6 + extra) / aspect);
    this.camera.left = -span * aspect / 2; this.camera.right = span * aspect / 2; this.camera.top = span / 2; this.camera.bottom = -span / 2;
    this.camera.updateProjectionMatrix(); this.camera.lookAt(0, .7, this.centerZ); this.renderer.setSize(w, h, false); this.render();
  }
  private render() { this.renderer.render(this.scene, this.camera); }
  private pick = (event: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect(); this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera);
    const hits = this.raycaster.intersectObjects([this.desks, this.terrain], true);
    for (const hit of hits) { let obj: THREE.Object3D | null = hit.object; while (obj && !obj.userData.kind) obj = obj.parent; if (obj?.userData.kind === 'entry') { this.onEnter(); return; } if (obj?.userData.kind === 'robot' || obj?.userData.kind === 'member') { this.onSelect({ kind: obj.userData.kind, id: obj.userData.id }); return; } }
  };
  private configureMotion = () => {
    this.renderer.setAnimationLoop(null);
    for (const g of this.bots.values()) { g.rotation.z = 0; g.position.y = .38; }
    if (!this.motion.matches) this.renderer.setAnimationLoop(time => {
      if (time - this.previous < 50) return; this.previous = time;
      for (const g of this.bots.values()) {
        const status = g.userData.status, offset = g.userData.index;
        g.rotation.z = status === 'tool' || status === 'working' ? Math.sin(time * .008 + offset) * .055 : status === 'reading' ? -.09 : 0;
        g.position.y = .38 + (status === 'waiting' ? Math.sin(time * .004) * .035 : status === 'completed' ? Math.abs(Math.sin(time * .003)) * .08 : 0);
      }
      this.render();
    });
    this.render();
  };
  dispose() {
    this.observer.disconnect(); this.motion.removeEventListener('change', this.configureMotion); this.renderer.setAnimationLoop(null); this.renderer.domElement.removeEventListener('click', this.pick);
    this.release(this.terrain); this.release(this.desks); this.release(this.roof); this.selectionRing.geometry.dispose(); (this.selectionRing.material as THREE.Material).dispose(); this.materials.forEach(m => m.dispose()); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
