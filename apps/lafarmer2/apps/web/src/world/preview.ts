import type { Clothing, HairStyle } from "@lafarmer2/content";
import * as THREE from "three";
import { createFarmer } from "./farmer";
import { installShaderChunks } from "./shared";

/** Turns per second while nobody drags the preview. */
const SPIN = 0.08;
const DRAG_TURN = 0.012;

/**
 * The farmer on a turntable for the character screen, in warm late-afternoon light with a soft
 * contact shadow. Dragging turns it; it breathes and looks around while it stands.
 */
export const mountCharacterPreview = (host: HTMLElement, clothing: Clothing, hair: HairStyle): (() => void) => {
  installShaderChunks();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";
  canvas.setAttribute("aria-hidden", "true");
  host.replaceChildren(canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe4efff, 0x6b5a3c, 1.15));
  const sun = new THREE.DirectionalLight(0xffdcae, 2.8);
  sun.position.set(2.2, 3.6, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -1.2;
  sun.shadow.camera.right = 1.2;
  sun.shadow.camera.top = 2.2;
  sun.shadow.camera.bottom = -0.4;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 9;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  const rim = new THREE.DirectionalLight(0xbcd2ff, 1.1);
  rim.position.set(-2.6, 2.2, -2.8);
  scene.add(sun, rim);

  const floorGeometry = new THREE.CircleGeometry(1.1, 48).rotateX(-Math.PI / 2);
  const floorMaterial = new THREE.ShadowMaterial({ color: 0x2c3a1c, opacity: 0.32 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.receiveShadow = true;
  scene.add(floor);

  const farmer = createFarmer({ clothing, hair });
  farmer.root.rotation.y = 0.5;
  scene.add(farmer.root);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0, 1.3, 3.9);
  camera.lookAt(0, 0.92, 0);

  const resize = (): void => {
    const width = host.clientWidth || 220;
    const height = host.clientHeight || 260;
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  let dragging = false;
  let lastX = 0;
  let idle = 0;
  const handlePointerDown = (event: PointerEvent): void => {
    dragging = true;
    lastX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  };
  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    farmer.root.rotation.y += (event.clientX - lastX) * DRAG_TURN;
    lastX = event.clientX;
    idle = 0;
  };
  const handlePointerUp = (event: PointerEvent): void => {
    dragging = false;
    canvas.style.cursor = "grab";
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    idle += dt;
    if (!dragging && idle > 1.5) farmer.root.rotation.y += dt * SPIN * Math.PI * 2 * Math.min(1, (idle - 1.5) / 1.5);
    farmer.animate(dt, 0);
    renderer.render(scene, camera);
  });

  return () => {
    renderer.setAnimationLoop(null);
    observer.disconnect();
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", handlePointerUp);
    farmer.dispose();
    floorGeometry.dispose();
    floorMaterial.dispose();
    renderer.dispose();
    // Every outfit click mounts a new preview; browsers cap the live WebGL contexts.
    renderer.forceContextLoss();
    host.replaceChildren();
  };
};
