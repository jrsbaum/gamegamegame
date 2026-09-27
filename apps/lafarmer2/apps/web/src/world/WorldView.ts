import {
  PLAYER_SPAWN,
  getContentDefinition,
  type Clothing,
  type HairStyle
} from "@lafarmer2/content";
import * as THREE from "three";
import type { RealtimeClient, WorldPresence } from "../network";
import { createChaseCamera, type ChaseCamera } from "./chaseCamera";
import { createWalker, facingDirection, placeWalker, stepWalker, type Circle, type Walker, type WalkerWorld } from "./controller";
import { createCow, createDinosaur, createEgg, createFossil, type Creature } from "./creatures";
import { createCrop, type Crop } from "./crops";
import { parseFarmItem, parseList, parsePlayer, parseStructure, type FarmItemData, type PlayerData, type StructureData } from "./farmData";
import { createFarmer, type Farmer } from "./farmer";
import { hashString, tileToWorld, tileToWorldX, tileToWorldZ, walkHeight } from "./height";
import { INITIAL_CAMERA_YAW, farmerRootYaw, type Direction } from "./movement";
import { createStructure, type Structure } from "./structures";
import { createValleyScene, type ValleyScene } from "./valleyScene";
import { errorText, pickAction, tileBlocked, type PlayerAction, type RuleStructure } from "./worldRules";

export type { Direction } from "./movement";

export type WorldCallbacks = {
  realtime: RealtimeClient;
  appearance: { clothing: Clothing; hair: HairStyle };
  name: string;
  inventory: Record<string, number>;
  onCoins: (coins: number) => void;
  onInventory: (inventory: Record<string, number>, qualities?: Record<string, Partial<Record<string, number>>>) => void;
  onProduction: (ready: number, total: number) => void;
  onPresence: (presence: WorldPresence[]) => void;
  onSnapshot: (snapshot: Record<string, unknown>) => void;
  onMarket: () => void;
  onConnectionPrompt: (message: string) => void;
  onMessage: (text: string) => void;
  onTime?: (label: string) => void;
};

const PENDING_LIMIT = 8;
const REGION_GAP = 1_000;

type PlacedStructure = { data: StructureData; structure: Structure; key: string };
type PlacedItem = { data: FarmItemData; form: string; crop?: Crop; creature?: Creature; penId: string; radius: number };
type Remote = { data: PlayerData; farmer: Farmer; tag: HTMLElement; x: number; z: number; goalX: number; goalZ: number; heading: number };
type FloatText = { element: HTMLElement; x: number; y: number; z: number; born: number };
type PendingMove = { actionId: string; direction: Direction };

const cropState = (data: FarmItemData) => ({
  stageId: data.stageId,
  plantedAt: data.plantedAt,
  ready: data.ready,
  pendingQuantity: data.pendingQuantity,
  nextProductionAt: data.nextProductionAt
});

const formOf = (data: FarmItemData): string | undefined => {
  if (data.contentId === "cow") return `cow:${data.stageId === "baby" ? "baby" : "adult"}:${data.variant}`;
  if (data.contentId !== "dinosaur") return undefined;
  const stage = data.stageId === "fossil" || data.stageId === "egg" || data.stageId === "hatchling" ? data.stageId : "adult";
  return `dinosaur:${stage}:${data.variant}`;
};

const radiusOf = (form: string): number => {
  if (form.startsWith("cow:baby")) return 0.35;
  if (form.startsWith("cow:")) return 0.55;
  if (form.startsWith("dinosaur:hatchling")) return 0.35;
  if (form.startsWith("dinosaur:adult")) return 0.7;
  return 0.25;
};

const createCreature = (data: FarmItemData): Creature | undefined => {
  const seed = hashString(data.id);
  if (data.contentId === "cow") return createCow(data.variant, data.stageId === "baby" ? "baby" : "adult", seed);
  if (data.contentId !== "dinosaur") return undefined;
  if (data.stageId === "fossil") return createFossil(seed);
  if (data.stageId === "egg") return createEgg(data.variant, seed);
  return createDinosaur(data.variant, data.stageId === "hatchling" ? "hatchling" : "adult", seed);
};

const typingTarget = (event: Event): boolean => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
};

const askedHour = (): number | undefined => {
  const raw = new URLSearchParams(location.search).get("hora");
  if (raw === null) return undefined;
  const hour = Number(raw);
  return Number.isFinite(hour) ? hour : undefined;
};

/**
 * The playable valley: a continuous walker, a chase camera and the server's farm, brought in
 * while a loading screen covers the first frame. Messages that arrive early wait their turn.
 */
export class WorldView {
  private readonly root: HTMLElement;
  private readonly callbacks: WorldCallbacks;
  private readonly keys = new Set<string>();
  private readonly pending: PendingMove[] = [];
  private readonly queue: Array<Record<string, unknown>> = [];
  private readonly structures = new Map<string, PlacedStructure>();
  private readonly items = new Map<string, FarmItemData>();
  private readonly visuals = new Map<string, PlacedItem>();
  private readonly remotes = new Map<string, Remote>();
  private readonly localStructureIds = new Set<string>();
  private readonly earlyStructures: StructureData[] = [];
  private readonly circles: Circle[] = [];
  private readonly feet = new THREE.Vector3();
  private readonly playerPoint = new THREE.Vector3();
  private readonly projector = new THREE.Vector3();
  private readonly floats: FloatText[] = [];
  private readonly walkWorld: WalkerWorld = {
    blocked: (tileX, tileY) => this.tileBlocked(tileX, tileY),
    circles: this.circles
  };

  private valley: ValleyScene | undefined;
  private farmer: Farmer | undefined;
  private walker: Walker | undefined;
  private chase: ChaseCamera | undefined;
  private look: { clothing: Clothing; hair: HairStyle };
  private inventory: Record<string, number>;
  private presence: WorldPresence[] = [];
  private playerId = "";
  private currentRegionId = "";
  private placed = false;
  private ready = false;
  private disposed = false;
  private heard = false;
  private wantMuted = false;
  private nextSnapshotFull = true;
  private fade = 0;
  private fadeGoal = 0;
  private pendingTeleport: { x: number; y: number; regionId: string } | null = null;
  private regionLock = 0;
  private lastHud = "";
  private timeLabel = "";
  private timeWait = 0;
  private cropClock = 0;
  private clock = 0;
  private lastFrame = 0;
  private raf = 0;
  private stickX = 0;
  private stickY = 0;
  private stickPointer = -1;
  private touchRun = false;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private pinch = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();

  private loading: HTMLElement | undefined;
  private tagLayer: HTMLElement | undefined;
  private prompt: HTMLElement | undefined;
  private promptLabel: HTMLElement | undefined;
  private joystick: HTMLElement | undefined;
  private unbindRealtime: (() => void) | undefined;
  private observer: ResizeObserver | undefined;

  constructor(root: HTMLElement, callbacks: WorldCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.look = { ...callbacks.appearance };
    this.inventory = callbacks.inventory;
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    this.mountLoading();
    this.unbindRealtime = callbacks.realtime.onMessage((message) => {
      if (!this.ready) this.queue.push(message);
      else this.handleMessage(message);
    });
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    void this.boot();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.observer?.disconnect();
    this.unbindRealtime?.();
    this.unbindPlay();
    this.loading?.remove();
    this.joystick?.remove();
    this.tagLayer?.remove();
    this.floats.forEach((entry) => entry.element.remove());
    this.visuals.forEach((entry) => this.disposeVisual(entry));
    this.visuals.clear();
    this.structures.forEach((entry) => entry.structure.dispose());
    this.structures.clear();
    this.remotes.forEach((remote) => this.disposeRemote(remote));
    this.remotes.clear();
    this.farmer?.dispose();
    if (this.valley) {
      this.valley.renderer.forceContextLoss();
      this.valley.dispose();
      this.valley = undefined;
    }
  }

  setInventory(inventory: Record<string, number>): void {
    this.inventory = inventory;
    this.callbacks.inventory = inventory;
  }

  applyStructure(structure: { id: string; type: string; footprint: Array<[number, number]>; regionId?: string; ownerId?: string }): void {
    const data = parseStructure({ ...structure, regionId: structure.regionId || this.currentRegionId }, structure.ownerId || this.playerId);
    if (!data) return;
    if (!this.ready || !this.valley) {
      this.earlyStructures.push(data);
      return;
    }
    this.localStructureIds.add(data.id);
    this.upsertStructure(data);
    this.refreshPens();
  }

  applyAppearance(clothing: Clothing, hair: HairStyle): void {
    this.look = { clothing, hair };
    this.farmer?.setLook(this.look);
  }

  setMuted(muted: boolean): void {
    this.wantMuted = muted;
    this.valley?.sound.setMuted(muted);
  }

  isMuted(): boolean {
    return this.valley?.sound.isMuted() ?? this.wantMuted;
  }

  private mountLoading(): void {
    const loading = document.createElement("div");
    loading.className = "fixed inset-0 z-40 grid place-items-center bg-ink px-6 text-cream";
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.innerHTML = `<div class="w-72 max-w-full">
      <p class="font-display text-4xl">Abrindo o vale</p>
      <p data-loading-label class="mt-3 text-cream/80">Preparando o chão</p>
      <div class="mt-4 h-1 bg-cream/20" aria-hidden="true"><div data-loading-bar class="h-full bg-amber" style="width:0%"></div></div>
    </div>`;
    document.body.append(loading);
    this.loading = loading;
  }

  private reportProgress(fraction: number, label: string): void {
    const bar = this.loading?.querySelector<HTMLElement>("[data-loading-bar]");
    const text = this.loading?.querySelector("[data-loading-label]");
    if (bar) bar.style.width = `${Math.round(fraction * 100)}%`;
    if (text) text.textContent = label;
  }

  private async boot(): Promise<void> {
    try {
      const valley = await createValleyScene({
        host: this.root,
        hour: askedHour(),
        onProgress: (fraction, label) => this.reportProgress(fraction, label)
      });
      if (this.disposed) {
        valley.renderer.forceContextLoss();
        valley.dispose();
        return;
      }
      this.valley = valley;
      if (this.wantMuted) valley.sound.setMuted(true);
      const canvas = valley.renderer.domElement;
      canvas.style.cursor = "grab";
      const spawn = tileToWorld(PLAYER_SPAWN.x, PLAYER_SPAWN.y);
      this.walker = createWalker(spawn.x, spawn.z, INITIAL_CAMERA_YAW);
      placeWalker(this.walker, PLAYER_SPAWN.x, PLAYER_SPAWN.y);
      this.farmer = createFarmer(this.look);
      valley.add(this.farmer.root);
      this.chase = createChaseCamera({ yaw: INITIAL_CAMERA_YAW, solid: (x, y, z) => this.solidAt(x, y, z) });
      this.mountHud();
      this.bindPlay(canvas);
      this.observer = new ResizeObserver(() => this.valley?.resize());
      this.observer.observe(this.root);
      this.syncFarmer();
      this.chase.snap();
      this.chase.update(valley.camera, { x: this.walker.x, y: walkHeight(this.walker.x, this.walker.z), z: this.walker.z }, { x: 0, z: 0 }, 0);
      this.ready = true;
      const queued = this.queue.splice(0);
      for (const message of queued) this.handleMessage(message);
      for (const structure of this.earlyStructures) {
        this.localStructureIds.add(structure.id);
        this.upsertStructure(structure);
      }
      this.earlyStructures.length = 0;
      this.refreshPens();
      this.loading?.remove();
      this.loading = undefined;
      this.noteTime(1);
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    } catch {
      this.reportProgress(0, "Não foi possível abrir o vale.");
    }
  }

  private mountHud(): void {
    const tags = document.createElement("div");
    tags.className = "pointer-events-none absolute inset-0 overflow-hidden";
    const prompt = document.createElement("div");
    prompt.className = "absolute hidden -translate-x-1/2 -translate-y-full";
    prompt.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "inline-flex items-center gap-2 bg-cream/95 px-2 py-1 text-sm text-ink shadow-slat";
    const key = document.createElement("kbd");
    key.className = "bg-ink px-1.5 py-0.5 font-bold text-cream";
    key.textContent = "E";
    label.append(key);
    const text = document.createElement("span");
    label.append(text);
    prompt.append(label);
    tags.append(prompt);
    this.root.append(tags);
    this.tagLayer = tags;
    this.prompt = prompt;
    this.promptLabel = text;

    const joystick = document.createElement("div");
    joystick.className = "absolute left-3 top-1/2 z-10 -translate-y-1/2 md:hidden";
    joystick.innerHTML = `<div data-stick class="relative h-32 w-32 touch-none" aria-label="Andar" role="application">
        <div class="absolute inset-0 rounded-full border border-cream/50 bg-ink/45"></div>
        <div data-knob class="absolute left-1/2 top-1/2 h-12 w-12 -ml-6 -mt-6 rounded-full bg-cream/95"></div>
      </div>
      <button data-run type="button" class="mt-3 w-32 bg-cream/95 py-3 font-bold text-ink" aria-label="Correr">Correr</button>`;
    this.root.append(joystick);
    this.joystick = joystick;
    const stick = joystick.querySelector<HTMLElement>("[data-stick]")!;
    const knob = joystick.querySelector<HTMLElement>("[data-knob]")!;
    const run = joystick.querySelector<HTMLButtonElement>("[data-run]")!;
    const moveStick = (event: PointerEvent): void => {
      if (event.pointerId !== this.stickPointer) return;
      const rect = stick.getBoundingClientRect();
      const max = rect.width * 0.36;
      let dx = event.clientX - (rect.left + rect.width / 2);
      let dy = event.clientY - (rect.top + rect.height / 2);
      const length = Math.hypot(dx, dy) || 1;
      const scale = Math.min(max, length) / length;
      dx *= scale;
      dy *= scale;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stickX = dx / max;
      this.stickY = -dy / max;
    };
    stick.addEventListener("pointerdown", (event) => {
      this.stickPointer = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      this.resumeSound();
      moveStick(event);
    });
    stick.addEventListener("pointermove", moveStick);
    const releaseStick = (event: PointerEvent): void => {
      if (event.pointerId !== this.stickPointer) return;
      this.stickPointer = -1;
      this.stickX = 0;
      this.stickY = 0;
      knob.style.transform = "";
    };
    stick.addEventListener("pointerup", releaseStick);
    stick.addEventListener("pointercancel", releaseStick);
    const holdRun = (held: boolean) => (event: PointerEvent): void => {
      event.preventDefault();
      this.touchRun = held;
      this.resumeSound();
    };
    run.addEventListener("pointerdown", holdRun(true));
    run.addEventListener("pointerup", holdRun(false));
    run.addEventListener("pointercancel", holdRun(false));
    run.addEventListener("pointerleave", holdRun(false));
  }

  private playCanvas: HTMLCanvasElement | undefined;

  private bindPlay(canvas: HTMLCanvasElement): void {
    this.playCanvas = canvas;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerUp);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.blockContextMenu);
  }

  private unbindPlay(): void {
    const canvas = this.playCanvas;
    if (!canvas) return;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointercancel", this.handlePointerUp);
    canvas.removeEventListener("wheel", this.handleWheel);
    canvas.removeEventListener("contextmenu", this.blockContextMenu);
  }

  private resumeSound(): void {
    if (this.heard) return;
    this.heard = true;
    void this.valley?.sound.resume();
  }

  private dialogOpen(): boolean {
    const host = document.querySelector("#dialog-host");
    return Boolean(host && host.childElementCount > 0);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (typingTarget(event) || this.dialogOpen()) return;
    const key = event.key.toLowerCase();
    if (event.repeat && key === "e") return;
    if (key === " " || key.startsWith("arrow")) event.preventDefault();
    this.keys.add(key);
    this.resumeSound();
    if (key === "e") this.interact();
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private blockContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 2) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.resumeSound();
    if (this.pointers.size >= 2) {
      this.dragging = false;
      this.pinch = this.pointerSpan();
      return;
    }
    this.dragging = true;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.playCanvas?.setPointerCapture(event.pointerId);
    if (this.playCanvas) this.playCanvas.style.cursor = "grabbing";
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      const span = this.pointerSpan();
      if (this.pinch > 0) this.chase?.zoom((this.pinch - span) * 2);
      this.pinch = span;
      return;
    }
    if (!this.dragging || !this.chase) return;
    this.chase.drag(event.clientX - this.dragX, event.clientY - this.dragY);
    this.dragX = event.clientX;
    this.dragY = event.clientY;
  };

  private handlePointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = 0;
    if (this.pointers.size === 0) {
      this.dragging = false;
      if (this.playCanvas) this.playCanvas.style.cursor = "grab";
    }
    if (this.playCanvas?.hasPointerCapture(event.pointerId)) this.playCanvas.releasePointerCapture(event.pointerId);
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.chase?.zoom(event.deltaY);
  };

  private pointerSpan(): number {
    const points = [...this.pointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  private tick = (): void => {
    if (this.disposed || !this.valley || !this.walker || !this.farmer || !this.chase) return;
    const now = performance.now();
    const raw = Math.min(1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const dt = Math.min(0.05, raw);
    this.clock += dt;
    this.advanceFade(dt);
    if (this.keys.has("q")) this.chase.turn(2.2 * dt);
    if (this.keys.has("r")) this.chase.turn(-2.2 * dt);
    this.refreshCircles();
    const frozen = this.fade > 0.15 || this.pendingTeleport !== null || this.dialogOpen();
    const intent = frozen ? { x: 0, z: 0, run: false } : this.readIntent();
    const steps = stepWalker(this.walker, intent, dt, this.walkWorld);
    this.reportSteps(steps);
    this.syncFarmer(dt);
    this.valley.scene.updateMatrixWorld();
    for (const entry of this.structures.values()) entry.structure.update(this.clock);
    for (const visual of this.visuals.values()) {
      visual.creature?.update(dt, this.clock, this.playerPoint);
    }
    this.cropClock += dt;
    if (this.cropClock >= 1) {
      this.cropClock = 0;
      const time = Date.now();
      for (const visual of this.visuals.values()) visual.crop?.update(cropState(visual.data), time);
    }
    this.stepRemotes(dt);
    const feetY = walkHeight(this.walker.x, this.walker.z);
    this.feet.set(this.walker.x, feetY, this.walker.z);
    this.chase.update(this.valley.camera, { x: this.walker.x, y: feetY, z: this.walker.z }, { x: this.walker.vx, z: this.walker.vz }, dt);
    this.orientFarmer();
    this.refreshPrompt();
    this.stepFloats(now);
    this.valley.setFade(this.fade);
    this.valley.frame({ dt, raw, focus: this.feet, speed: Math.hypot(this.walker.vx, this.walker.vz) });
    this.noteTime(dt);
    this.raf = requestAnimationFrame(this.tick);
  };

  private advanceFade(dt: number): void {
    this.fade += (this.fadeGoal - this.fade) * (1 - Math.exp(-10 * dt));
    if (Math.abs(this.fade - this.fadeGoal) < 0.01) this.fade = this.fadeGoal;
    if (!this.pendingTeleport || this.fade < 0.92 || !this.walker || !this.chase) return;
    const spot = this.pendingTeleport;
    this.pendingTeleport = null;
    this.pending.length = 0;
    this.currentRegionId = spot.regionId || this.currentRegionId;
    placeWalker(this.walker, spot.x, spot.y);
    this.chase.snap();
    this.fadeGoal = 0;
  }

  private readIntent(): { x: number; z: number; run: boolean } {
    if (!this.chase) return { x: 0, z: 0, run: false };
    let forward = this.stickY;
    let strafe = this.stickX;
    if (this.keys.has("w") || this.keys.has("arrowup")) forward += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) forward -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) strafe += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) strafe -= 1;
    const viewForward = this.chase.forward();
    const viewRight = this.chase.right();
    const x = viewForward.x * forward + viewRight.x * strafe;
    const z = viewForward.z * forward + viewRight.z * strafe;
    const length = Math.hypot(x, z);
    if (length < 0.08) return { x: 0, z: 0, run: false };
    const scale = Math.min(1, length);
    const run = this.touchRun || this.keys.has("shift") || this.keys.has(" ");
    return { x: (x / length) * scale, z: (z / length) * scale, run };
  }

  private reportSteps(steps: Direction[]): void {
    if (this.callbacks.realtime.status !== "connected") return;
    for (const direction of steps) {
      if (this.pending.length >= PENDING_LIMIT) return;
      const actionId = this.callbacks.realtime.move(direction, false);
      if (!actionId) return;
      this.pending.push({ actionId, direction });
    }
  }

  private syncFarmer(dt = 0): void {
    if (!this.farmer || !this.walker) return;
    const y = walkHeight(this.walker.x, this.walker.z);
    this.farmer.root.position.set(this.walker.x, y, this.walker.z);
    this.orientFarmer();
    this.farmer.animate(dt, Math.hypot(this.walker.vx, this.walker.vz));
    this.playerPoint.set(this.walker.x, y, this.walker.z);
  }

  /** Nose on the chase yaw (HUD forward); the back stays toward the lens. Strafe and reverse do not yaw the body. */
  private orientFarmer(): void {
    if (!this.farmer || !this.walker || !this.chase) return;
    const yaw = this.chase.yaw();
    this.walker.heading = yaw;
    this.farmer.root.rotation.y = farmerRootYaw(yaw);
  }

  private tileBlocked(tileX: number, tileY: number): boolean {
    if (!this.walker) return true;
    return tileBlocked(tileX, tileY, { x: this.walker.tileX, y: this.walker.tileY }, this.currentRegionId, this.playerId, this.ruleStructures());
  }

  private ruleStructures(): RuleStructure[] {
    return [...this.structures.values()].map((entry) => ({
      id: entry.data.id,
      ownerId: entry.data.ownerId,
      type: entry.data.type,
      tiles: entry.structure.tiles,
      regionId: entry.data.regionId
    }));
  }

  private solidAt(x: number, y: number, z: number): boolean {
    if (this.valley?.solid(x, y, z)) return true;
    for (const entry of this.structures.values()) if (entry.structure.solid(x, y, z)) return true;
    return false;
  }

  private refreshCircles(): void {
    if (!this.valley) return;
    this.circles.length = 0;
    this.circles.push(...this.valley.colliders);
    for (const visual of this.visuals.values()) {
      if (visual.crop) this.circles.push(...visual.crop.colliders);
      if (visual.creature) this.circles.push({ x: visual.creature.root.position.x, z: visual.creature.root.position.z, radius: visual.radius });
    }
  }

  private refreshPrompt(): void {
    if (!this.walker) return;
    const action = pickAction({
      tile: { x: this.walker.tileX, y: this.walker.tileY },
      facing: facingDirection(this.walker),
      regionId: this.currentRegionId,
      playerId: this.playerId,
      inventory: this.inventory,
      presence: this.presence,
      structures: this.ruleStructures(),
      items: [...this.items.values()]
    });
    const hud = action?.hud ?? "";
    if (hud !== this.lastHud) {
      this.lastHud = hud;
      this.callbacks.onConnectionPrompt(hud);
    }
    if (!this.prompt || !this.promptLabel) return;
    if (!action) {
      this.prompt.classList.add("hidden");
      return;
    }
    this.prompt.classList.remove("hidden");
    this.promptLabel.textContent = action.label;
    const point = tileToWorld(action.tile.x, action.tile.y);
    this.placeBadge(this.prompt, point.x, point.y + 1.6, point.z);
  }

  private interact(): void {
    if (!this.ready || !this.walker || this.dialogOpen()) return;
    const action = pickAction({
      tile: { x: this.walker.tileX, y: this.walker.tileY },
      facing: facingDirection(this.walker),
      regionId: this.currentRegionId,
      playerId: this.playerId,
      inventory: this.inventory,
      presence: this.presence,
      structures: this.ruleStructures(),
      items: [...this.items.values()]
    });
    if (!action) {
      this.callbacks.onMessage("Nada para fazer aqui. Chegue a uma planta, uma criatura, uma passagem ou ao mercadinho.");
      return;
    }
    if (action.kind === "visit") {
      if (performance.now() < this.regionLock) return;
      this.regionLock = performance.now() + REGION_GAP;
      if (!this.callbacks.realtime.enterRegion(action.regionId)) this.callbacks.onMessage("Sem conexão para visitar agora.");
      return;
    }
    if (action.kind === "work") {
      if (!this.callbacks.realtime.action(action.action, { itemId: action.itemId })) this.callbacks.onMessage("Sem conexão para isso agora.");
      return;
    }
    if (action.kind === "market") {
      this.callbacks.onMarket();
      return;
    }
    if (action.kind === "plant") {
      if (!this.callbacks.realtime.action("farm.plant", { contentId: action.contentId, x: action.tile.x, y: action.tile.y })) {
        this.callbacks.onMessage("Sem conexão para plantar.");
      }
      return;
    }
    if (!this.callbacks.realtime.action("farm.adopt", { contentId: action.contentId })) this.callbacks.onMessage("Sem conexão para adotar.");
  }

  private noteTime(dt: number): void {
    this.timeWait += dt;
    if (this.timeWait < 0.5) return;
    this.timeWait = 0;
    const label = this.valley?.day.label() ?? "";
    if (!label || label === this.timeLabel) return;
    this.timeLabel = label;
    this.callbacks.onTime?.(label);
  }

  private handleMessage(message: Record<string, unknown>): void {
    const type = message.type;
    if (type === "wallet.updated") {
      const payload = message.payload as { coins?: number; inventory?: Record<string, number> } | undefined;
      if (typeof payload?.coins === "number") this.callbacks.onCoins(payload.coins);
      if (payload?.inventory) this.callbacks.onInventory(payload.inventory);
    }
    if (type === "farm.harvested") this.onHarvested(message);
    if (type === "farm.collected") this.onCollected(message);
    if (type === "farm.updated") {
      const item = parseFarmItem(message.item);
      if (item) this.upsertItem(item);
      this.notifyProduction();
    }
    if (type === "farm.structure.built") {
      const structure = parseStructure(message.structure, this.playerId);
      if (structure) {
        this.localStructureIds.add(structure.id);
        this.upsertStructure(structure);
        this.refreshPens();
      }
    }
    if (type === "hello" || type === "snapshot") this.applySnapshot(message.snapshot);
    if (type === "world.presence") this.setPresence(message.presence);
    if (type === "world.region.entered") this.onRegionEntered(message.player);
    if (type === "player_joined" || type === "player_moved" || type === "player_region_changed") {
      const player = parsePlayer(message.player);
      if (player && player.id !== this.playerId) this.upsertRemote(player);
    }
    if (type === "player_left" && typeof message.playerId === "string") this.removeRemote(message.playerId);
    if (type === "move_ack") this.onMoveAck(message);
    if (type === "error" && typeof message.code === "string") this.callbacks.onMessage(errorText(message.code));
  }

  private onHarvested(message: Record<string, unknown>): void {
    const item = parseFarmItem(message.item);
    if (item) {
      const definition = getContentDefinition(item.contentId);
      if (!definition || definition.cycleSeconds === null) this.removeItem(item.id);
    }
    if (typeof message.coins === "number") this.callbacks.onCoins(message.coins);
    if (message.inventory && typeof message.inventory === "object") this.callbacks.onInventory(message.inventory as Record<string, number>);
    if (typeof message.quantity === "number" && message.quantity > 0) this.floatText(`+${message.quantity}`);
    this.notifyProduction();
  }

  private onCollected(message: Record<string, unknown>): void {
    const item = parseFarmItem(message.item);
    if (item) this.upsertItem(item);
    if (message.inventory && typeof message.inventory === "object") this.callbacks.onInventory(message.inventory as Record<string, number>);
    if (typeof message.quantity === "number" && message.quantity > 0) this.floatText(`+${message.quantity}`);
    this.notifyProduction();
  }

  private onRegionEntered(value: unknown): void {
    const player = parsePlayer(value);
    if (!player || !this.walker || !this.chase) return;
    this.pending.length = 0;
    this.nextSnapshotFull = true;
    this.currentRegionId = player.regionId;
    if (!this.placed) {
      placeWalker(this.walker, player.x, player.y);
      this.chase.snap();
      this.placed = true;
      return;
    }
    this.pendingTeleport = { x: player.x, y: player.y, regionId: player.regionId };
    this.fadeGoal = 1;
  }

  private onMoveAck(message: Record<string, unknown>): void {
    if (typeof message.actionId === "string") {
      const index = this.pending.findIndex((entry) => entry.actionId === message.actionId);
      if (index >= 0) this.pending.splice(index, 1);
    }
    const player = parsePlayer(message.player);
    if (!player || !this.walker || !this.chase || this.pendingTeleport) return;
    const drift = Math.abs(this.walker.tileX - player.x) + Math.abs(this.walker.tileY - player.y);
    if (drift <= this.pending.length) return;
    placeWalker(this.walker, player.x, player.y);
    if (drift > 2) this.chase.snap();
  }

  private applySnapshot(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const snapshot = value as Record<string, unknown>;
    const player = snapshot.player as Record<string, unknown> | undefined;
    if (typeof player?.coins === "number") this.callbacks.onCoins(player.coins);
    if (player?.inventory && typeof player.inventory === "object") {
      const qualities = player.inventoryQualities;
      this.callbacks.onInventory(
        player.inventory as Record<string, number>,
        qualities && typeof qualities === "object" ? qualities as Record<string, Partial<Record<string, number>>> : undefined
      );
    }
    const self = parsePlayer(player);
    if (self) this.adoptSelf(self);
    this.setPresence(snapshot.presence);
    this.callbacks.onSnapshot(snapshot);
    const offline = snapshot.offlineProgress as { coins?: number } | undefined;
    if (offline?.coins) this.callbacks.onMessage(`Enquanto você esteve fora: +${offline.coins} moedas.`);
    const full = this.nextSnapshotFull;
    this.nextSnapshotFull = false;
    this.syncStructures(parseList(snapshot.structures, (entry) => parseStructure(entry, this.playerId)), full);
    this.syncItems(parseList(snapshot.farmItems, parseFarmItem));
    this.syncRemoteList(parseList(snapshot.players, parsePlayer));
    this.notifyProduction();
  }

  private adoptSelf(player: PlayerData): void {
    this.playerId = player.id;
    if (!this.walker || !this.chase) return;
    if (!this.placed) {
      this.currentRegionId = player.regionId;
      placeWalker(this.walker, player.x, player.y);
      this.chase.snap();
      this.placed = true;
      return;
    }
    if (player.regionId !== this.currentRegionId) {
      this.pending.length = 0;
      this.nextSnapshotFull = true;
      this.currentRegionId = player.regionId;
      this.pendingTeleport = { x: player.x, y: player.y, regionId: player.regionId };
      this.fadeGoal = 1;
      return;
    }
    if (this.pendingTeleport) {
      this.pendingTeleport = { x: player.x, y: player.y, regionId: player.regionId };
      return;
    }
    if (this.pending.length > 0) return;
    const drift = Math.abs(this.walker.tileX - player.x) + Math.abs(this.walker.tileY - player.y);
    if (drift === 0) return;
    placeWalker(this.walker, player.x, player.y);
    if (drift > 2) this.chase.snap();
  }

  private setPresence(value: unknown): void {
    if (!Array.isArray(value)) return;
    const presence: WorldPresence[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const raw = entry as WorldPresence;
      if (typeof raw.id !== "string") continue;
      presence.push(raw);
    }
    this.presence = presence;
    this.callbacks.onPresence(presence);
    for (const remote of [...this.remotes.values()]) this.upsertRemote(remote.data);
  }

  private syncStructures(list: StructureData[], full: boolean): void {
    const ids = new Set(list.map((structure) => structure.id));
    for (const structure of list) {
      this.localStructureIds.delete(structure.id);
      this.upsertStructure(structure);
    }
    for (const id of [...this.structures.keys()]) {
      if (ids.has(id)) continue;
      if (!full && this.localStructureIds.has(id)) continue;
      this.structures.get(id)?.structure.dispose();
      this.structures.delete(id);
      this.localStructureIds.delete(id);
    }
    this.refreshPens();
  }

  private upsertStructure(data: StructureData): void {
    if (!this.valley) return;
    const key = `${data.type}:${data.footprint.map(([x, y]) => `${x},${y}`).join(";")}`;
    const existing = this.structures.get(data.id);
    if (existing?.key === key) {
      existing.data = data;
      return;
    }
    existing?.structure.dispose();
    const structure = createStructure(data.type, data.id, data.footprint);
    this.valley.add(structure.root);
    this.structures.set(data.id, { data, structure, key });
  }

  private syncItems(list: FarmItemData[]): void {
    const ids = new Set(list.map((item) => item.id));
    for (const item of list) this.upsertItem(item);
    for (const id of [...this.items.keys()]) if (!ids.has(id)) this.removeItem(id);
  }

  private upsertItem(data: FarmItemData): void {
    if (!this.valley) return;
    this.items.set(data.id, data);
    const existing = this.visuals.get(data.id);
    if (data.contentId === "tomato" || data.contentId === "orange-tree") {
      if (existing?.crop && existing.data.contentId === data.contentId && existing.data.x === data.x && existing.data.y === data.y) {
        existing.data = data;
        existing.crop.update(cropState(data), Date.now());
        return;
      }
      this.removeVisual(data.id);
      const crop = createCrop(data.contentId, data.id, { x: data.x, y: data.y }, cropState(data), Date.now());
      if (!crop) return;
      this.valley.add(crop.root);
      this.visuals.set(data.id, { data, form: data.contentId, crop, penId: "", radius: 0 });
      return;
    }
    const form = formOf(data);
    if (!form) {
      this.removeVisual(data.id);
      return;
    }
    if (existing?.creature && existing.form === form) {
      existing.data = data;
      this.seatCreature(existing);
      return;
    }
    this.removeVisual(data.id);
    const creature = createCreature(data);
    if (!creature) return;
    this.valley.add(creature.root);
    const placed: PlacedItem = { data, form, creature, penId: "", radius: radiusOf(form) };
    this.seatCreature(placed);
    this.visuals.set(data.id, placed);
  }

  private seatCreature(placed: PlacedItem): void {
    if (!placed.creature) return;
    const structure = placed.data.structureId ? this.structures.get(placed.data.structureId) : undefined;
    const penId = structure?.data.id ?? `tile:${placed.data.x}:${placed.data.y}`;
    if (placed.penId !== penId) {
      const pen = structure
        ? structure.structure.pen
        : { x0: tileToWorldX(placed.data.x) - 1.2, x1: tileToWorldX(placed.data.x) + 1.2, z0: tileToWorldZ(placed.data.y) - 1.2, z1: tileToWorldZ(placed.data.y) + 1.2 };
      placed.creature.setPen(pen);
      placed.penId = penId;
    }
    placed.creature.setMood({ needsCare: placed.data.careState === "awaiting-care", happy: placed.data.behaviorState === "happy" });
  }

  private refreshPens(): void {
    for (const visual of this.visuals.values()) if (visual.creature) this.seatCreature(visual);
  }

  private removeItem(id: string): void {
    this.items.delete(id);
    this.removeVisual(id);
  }

  private removeVisual(id: string): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    this.disposeVisual(visual);
    this.visuals.delete(id);
  }

  private disposeVisual(visual: PlacedItem): void {
    visual.crop?.dispose();
    visual.creature?.dispose();
  }

  private syncRemoteList(players: PlayerData[]): void {
    const ids = new Set<string>();
    for (const player of players) {
      if (player.id === this.playerId) continue;
      ids.add(player.id);
      this.upsertRemote(player);
    }
    for (const id of [...this.remotes.keys()]) if (!ids.has(id)) this.removeRemote(id);
  }

  private upsertRemote(player: PlayerData): void {
    if (!this.valley || !this.tagLayer) return;
    const presence = this.presence.find((entry) => entry.id === player.id);
    if (player.regionId !== this.currentRegionId || presence?.online === false) {
      this.removeRemote(player.id);
      return;
    }
    const point = tileToWorld(player.x, player.y);
    const existing = this.remotes.get(player.id);
    if (existing) {
      existing.data = player;
      existing.goalX = point.x;
      existing.goalZ = point.z;
      existing.farmer.setLook({ clothing: player.clothing, hair: player.hair });
      existing.tag.textContent = player.name;
      if (Math.hypot(existing.goalX - existing.x, existing.goalZ - existing.z) > 18) {
        existing.x = existing.goalX;
        existing.z = existing.goalZ;
      }
      return;
    }
    const farmer = createFarmer({ clothing: player.clothing, hair: player.hair });
    this.valley.add(farmer.root);
    const tag = document.createElement("div");
    tag.className = "absolute -translate-x-1/2 -translate-y-full whitespace-nowrap bg-ink/75 px-2 py-0.5 text-xs text-cream";
    tag.textContent = player.name;
    this.tagLayer.append(tag);
    this.remotes.set(player.id, { data: player, farmer, tag, x: point.x, z: point.z, goalX: point.x, goalZ: point.z, heading: 0 });
  }

  private stepRemotes(dt: number): void {
    for (const remote of this.remotes.values()) {
      const dx = remote.goalX - remote.x;
      const dz = remote.goalZ - remote.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 18) {
        remote.x = remote.goalX;
        remote.z = remote.goalZ;
      } else if (distance > 0.03) {
        const step = Math.min(distance, 8 * dt);
        remote.x += (dx / distance) * step;
        remote.z += (dz / distance) * step;
        remote.heading = Math.atan2(dx, dz);
      }
      const y = walkHeight(remote.x, remote.z);
      remote.farmer.root.position.set(remote.x, y, remote.z);
      remote.farmer.root.rotation.y = farmerRootYaw(remote.heading);
      remote.farmer.animate(dt, distance > 0.05 ? Math.min(8, distance / Math.max(dt, 1e-4)) : 0);
      this.placeBadge(remote.tag, remote.x, y + 2.15, remote.z);
    }
  }

  private removeRemote(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    this.disposeRemote(remote);
    this.remotes.delete(id);
  }

  private disposeRemote(remote: Remote): void {
    remote.farmer.dispose();
    remote.farmer.root.removeFromParent();
    remote.tag.remove();
  }

  private notifyProduction(): void {
    let ready = 0;
    for (const item of this.items.values()) if (item.ready) ready += 1;
    this.callbacks.onProduction(ready, this.items.size);
  }

  private floatText(text: string): void {
    if (!this.tagLayer || !this.walker) return;
    const element = document.createElement("div");
    element.className = "pointer-events-none absolute -translate-x-1/2 font-display text-2xl text-amber";
    element.textContent = text;
    this.tagLayer.append(element);
    this.floats.push({ element, x: this.walker.x, y: walkHeight(this.walker.x, this.walker.z) + 2, z: this.walker.z, born: performance.now() });
  }

  private stepFloats(now: number): void {
    for (let index = this.floats.length - 1; index >= 0; index -= 1) {
      const entry = this.floats[index];
      const age = (now - entry.born) / 900;
      if (age >= 1) {
        entry.element.remove();
        this.floats.splice(index, 1);
        continue;
      }
      entry.element.style.opacity = String(1 - age);
      this.placeBadge(entry.element, entry.x, entry.y + age * 0.9, entry.z);
    }
  }

  private placeBadge(element: HTMLElement, x: number, y: number, z: number): void {
    const camera = this.valley?.camera;
    if (!camera) return;
    this.projector.set(x, y, z).project(camera);
    if (this.projector.z > 1) {
      element.style.visibility = "hidden";
      return;
    }
    const width = this.root.clientWidth || 1;
    const height = this.root.clientHeight || 1;
    element.style.visibility = "visible";
    element.style.left = `${(this.projector.x * 0.5 + 0.5) * width}px`;
    element.style.top = `${(-this.projector.y * 0.5 + 0.5) * height}px`;
  }

}
