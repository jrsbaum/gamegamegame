import * as THREE from "three";
import { createRandom } from "./height";

const TAU = Math.PI * 2;

export type Rng = {
  next: () => number;
  range: (min: number, max: number) => number;
  /** Integer in [min, max]. */
  int: (min: number, max: number) => number;
  /** Roughly normal, mean 0 and deviation 1. */
  gauss: () => number;
  sign: () => number;
};

export const createRng = (seed: number): Rng => {
  const random = createRandom(seed);
  const range = (min: number, max: number): number => min + (max - min) * random();
  return {
    next: random,
    range,
    int: (min, max) => Math.min(max, Math.floor(range(min, max + 1))),
    gauss: () => (random() + random() + random() + random() - 2) / 0.577,
    sign: () => (random() < 0.5 ? -1 : 1)
  };
};

type Rgb = readonly [number, number, number];

const css = (color: Rgb, scale = 1, alpha = 1): string =>
  `rgba(${Math.min(255, color[0] * scale) | 0},${Math.min(255, color[1] * scale) | 0},${Math.min(255, color[2] * scale) | 0},${alpha})`;

const createCanvas = (width: number, height: number): CanvasRenderingContext2D => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas unavailable");
  return context;
};

/**
 * Push-pull fill: every transparent texel takes the colour of the nearest opaque region, so the
 * mipmaps of alpha-tested cards average real colours instead of black fringes.
 */
const fillTransparent = (pixels: Uint8Array, width: number, height: number): void => {
  type Level = { width: number; height: number; rgb: Float32Array; weight: Float32Array };
  const base: Level = { width, height, rgb: new Float32Array(width * height * 3), weight: new Float32Array(width * height) };
  for (let index = 0; index < width * height; index += 1) {
    const opaque = pixels[index * 4 + 3] > 8 ? 1 : 0;
    base.weight[index] = opaque;
    for (let channel = 0; channel < 3; channel += 1) base.rgb[index * 3 + channel] = pixels[index * 4 + channel] * opaque;
  }
  const levels = [base];
  let current = base;
  while (current.width > 1 && current.height > 1) {
    const next: Level = {
      width: current.width >> 1,
      height: current.height >> 1,
      rgb: new Float32Array((current.width >> 1) * (current.height >> 1) * 3),
      weight: new Float32Array((current.width >> 1) * (current.height >> 1))
    };
    for (let y = 0; y < next.height; y += 1) {
      for (let x = 0; x < next.width; x += 1) {
        const target = y * next.width + x;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const source = (y * 2 + dy) * current.width + x * 2 + dx;
          next.weight[target] += current.weight[source];
          for (let channel = 0; channel < 3; channel += 1) next.rgb[target * 3 + channel] += current.rgb[source * 3 + channel];
        }
      }
    }
    levels.push(next);
    current = next;
  }
  for (let levelIndex = levels.length - 2; levelIndex >= 0; levelIndex -= 1) {
    const level = levels[levelIndex];
    const parent = levels[levelIndex + 1];
    for (let y = 0; y < level.height; y += 1) {
      for (let x = 0; x < level.width; x += 1) {
        const index = y * level.width + x;
        if (level.weight[index] > 0) continue;
        const parentIndex = Math.min(parent.height - 1, y >> 1) * parent.width + Math.min(parent.width - 1, x >> 1);
        const parentWeight = parent.weight[parentIndex];
        if (parentWeight <= 0) continue;
        for (let channel = 0; channel < 3; channel += 1) level.rgb[index * 3 + channel] = parent.rgb[parentIndex * 3 + channel] / parentWeight;
        level.weight[index] = 1;
      }
    }
  }
  for (let index = 0; index < width * height; index += 1) {
    if (pixels[index * 4 + 3] > 8) continue;
    const weight = base.weight[index] || 1;
    for (let channel = 0; channel < 3; channel += 1) pixels[index * 4 + channel] = base.rgb[index * 3 + channel] / weight;
    pixels[index * 4 + 3] = 0;
  }
};

/** Copies the canvas bottom-up (v grows up the drawing, like an image texture) into a mipmapped texture. */
const toTexture = (context: CanvasRenderingContext2D, srgb = true): THREE.DataTexture => {
  const { width, height } = context.canvas;
  const source = context.getImageData(0, 0, width, height).data;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    pixels.set(source.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
  }
  fillTransparent(pixels, width, height);
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
};

/** Notched cherry petal pointing down +y from the flower centre. */
const petalPath = (context: CanvasRenderingContext2D, length: number, width: number): void => {
  context.beginPath();
  context.moveTo(0, 0);
  context.bezierCurveTo(width * 0.9, length * 0.2, width * 1.05, length * 0.75, width * 0.32, length * 0.98);
  context.lineTo(0, length * 0.86);
  context.lineTo(-width * 0.32, length * 0.98);
  context.bezierCurveTo(-width * 1.05, length * 0.75, -width * 0.9, length * 0.2, 0, 0);
  context.closePath();
};

type BlossomPalette = { tip: Rgb; mid: Rgb; base: Rgb; eye: Rgb };

const drawBlossom = (context: CanvasRenderingContext2D, x: number, y: number, size: number, rng: Rng, palette: BlossomPalette): void => {
  context.save();
  context.translate(x, y);
  context.rotate(rng.range(0, TAU));
  context.scale(1, rng.range(0.55, 1));
  context.rotate(rng.range(0, TAU));
  const shade = rng.range(0.82, 1.08);
  for (let petal = 0; petal < 5; petal += 1) {
    context.save();
    context.rotate((petal * TAU) / 5 + rng.range(-0.12, 0.12));
    const length = size * rng.range(0.9, 1.1);
    const width = size * rng.range(0.52, 0.62);
    const gradient = context.createLinearGradient(0, 0, 0, length);
    gradient.addColorStop(0, css(palette.base, shade));
    gradient.addColorStop(0.45, css(palette.mid, shade));
    gradient.addColorStop(1, css(palette.tip));
    petalPath(context, length, width);
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = css(palette.base, 0.95, 0.25);
    context.lineWidth = size * 0.03;
    context.beginPath();
    context.moveTo(0, length * 0.1);
    context.lineTo(0, length * 0.7);
    context.stroke();
    context.restore();
  }
  context.fillStyle = css(palette.eye);
  context.beginPath();
  context.arc(0, 0, size * 0.2, 0, TAU);
  context.fill();
  for (let stamen = 0; stamen < 14; stamen += 1) {
    const angle = rng.range(0, TAU);
    const reach = size * rng.range(0.22, 0.42);
    context.strokeStyle = css(palette.eye, 1.15, 0.8);
    context.lineWidth = size * 0.025;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
    context.stroke();
    context.fillStyle = "rgb(245,210,110)";
    context.beginPath();
    context.arc(Math.cos(angle) * reach, Math.sin(angle) * reach, size * 0.04, 0, TAU);
    context.fill();
  }
  context.restore();
};

/** A forked twig crossing the cell; returns points along it where flowers and leaves attach. */
const drawTwigs = (context: CanvasRenderingContext2D, cx: number, cy: number, radius: number, rng: Rng, color: string, width: number): Array<[number, number]> => {
  const points: Array<[number, number]> = [];
  context.strokeStyle = color;
  context.lineCap = "round";
  const twig = (x: number, y: number, angle: number, length: number, lineWidth: number, depth: number): void => {
    const ex = x + Math.cos(angle) * length;
    const ey = y + Math.sin(angle) * length;
    const mx = (x + ex) / 2 + rng.range(-length, length) * 0.15;
    const my = (y + ey) / 2 + rng.range(-length, length) * 0.15;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(x, y);
    context.quadraticCurveTo(mx, my, ex, ey);
    context.stroke();
    points.push([mx, my], [ex, ey]);
    if (depth <= 0) return;
    for (let fork = 0; fork < 2; fork += 1) {
      const t = rng.next();
      twig(mx + (ex - mx) * t, my + (ey - my) * t, angle + rng.range(-0.9, 0.9), length * 0.55, lineWidth * 0.6, depth - 1);
    }
  };
  const angle = rng.range(0, TAU);
  twig(cx - Math.cos(angle) * radius * 0.95, cy - Math.sin(angle) * radius * 0.95, angle + rng.range(-0.3, 0.3), radius * 1.5, width, 2);
  return points;
};

/** UV rectangle [u0, v0, width, height] of an atlas cell numbered from the top-left of the drawing. */
export const atlasCell = (cell: number, columns: number, rows: number): [number, number, number, number] => {
  const width = 1 / columns;
  const height = 1 / rows;
  return [(cell % columns) * width, (rows - 1 - Math.floor(cell / columns)) * height, width, height];
};

/** Runs `draw` once per cell of a columns x rows atlas, clipped to the cell. */
const eachCell = (
  context: CanvasRenderingContext2D,
  columns: number,
  rows: number,
  draw: (cell: number, x0: number, y0: number, width: number, height: number) => void
): void => {
  const width = context.canvas.width / columns;
  const height = context.canvas.height / rows;
  for (let cell = 0; cell < columns * rows; cell += 1) {
    const x0 = (cell % columns) * width;
    const y0 = Math.floor(cell / columns) * height;
    context.save();
    context.beginPath();
    context.rect(x0, y0, width, height);
    context.clip();
    draw(cell, x0, y0, width, height);
    context.restore();
  }
};

const SAKURA_PALETTES: BlossomPalette[] = [
  { tip: [255, 244, 246], mid: [250, 205, 218], base: [236, 146, 172], eye: [178, 48, 90] },
  { tip: [255, 238, 243], mid: [246, 184, 204], base: [226, 112, 150], eye: [160, 32, 76] },
  { tip: [255, 250, 250], mid: [252, 222, 230], base: [240, 170, 190], eye: [190, 70, 100] },
  { tip: [255, 232, 240], mid: [244, 170, 196], base: [214, 94, 138], eye: [150, 28, 70] }
];

/** 2x2 atlas of blossom clusters on dark twigs, one shade of pink per cell. */
export const sakuraClusterTexture = (): THREE.DataTexture => {
  const context = createCanvas(1024, 1024);
  const rng = createRng(11);
  eachCell(context, 2, 2, (cell, x0, y0, size) => {
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const radius = size * 0.36;
    const twigs = drawTwigs(context, cx, cy, radius, rng, "rgb(58,40,38)", size * 0.022);
    const palette = SAKURA_PALETTES[cell];
    for (let leaf = 0; leaf < 7; leaf += 1) {
      const [x, y] = twigs[rng.int(0, twigs.length - 1)];
      context.save();
      context.translate(x, y);
      context.rotate(rng.range(0, TAU));
      context.fillStyle = rng.next() < 0.5 ? "rgb(122,120,58)" : "rgb(140,92,62)";
      context.beginPath();
      context.ellipse(size * 0.03, 0, size * 0.035, size * 0.014, 0, 0, TAU);
      context.fill();
      context.restore();
    }
    const flowers: Array<[number, number, number]> = [];
    for (let flower = 0; flower < 34; flower += 1) {
      let x: number;
      let y: number;
      if (rng.next() < 0.7) {
        const [tx, ty] = twigs[rng.int(0, twigs.length - 1)];
        x = tx + rng.gauss() * size * 0.05;
        y = ty + rng.gauss() * size * 0.05;
      } else {
        const angle = rng.range(0, TAU);
        const reach = Math.sqrt(rng.next()) * radius;
        x = cx + Math.cos(angle) * reach;
        y = cy + Math.sin(angle) * reach;
      }
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.hypot(dx, dy);
      if (distance > radius * 1.12) {
        x = cx + (dx / distance) * radius * 1.1;
        y = cy + (dy / distance) * radius * 1.1;
      }
      flowers.push([x, y, size * rng.range(0.045, 0.07)]);
    }
    flowers.sort((a, b) => a[2] - b[2]);
    for (const [x, y, flowerSize] of flowers) drawBlossom(context, x, y, flowerSize, rng, palette);
    for (let bud = 0; bud < 8; bud += 1) {
      const [x, y] = twigs[rng.int(0, twigs.length - 1)];
      context.fillStyle = css(palette.base, 0.8);
      context.beginPath();
      context.ellipse(x, y, size * 0.014, size * 0.02, rng.range(0, 3), 0, TAU);
      context.fill();
    }
  });
  return toTexture(context);
};

/** Seven-lobed maple leaf pointing up from its stem at the origin. */
const mapleLeafPath = (context: CanvasRenderingContext2D, radius: number, lobes: number): void => {
  context.beginPath();
  for (let index = 0; index <= lobes * 2; index += 1) {
    const angle = -Math.PI / 2 - Math.PI * 0.8 + (index / (lobes * 2)) * Math.PI * 1.6;
    const reach = index % 2 === 0 ? radius : radius * 0.42;
    if (index === 0) context.moveTo(0, radius * 0.1);
    context.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
  }
  context.lineTo(0, radius * 0.1);
  context.closePath();
};

const MAPLE_REDS: Rgb[] = [[150, 22, 26], [190, 40, 28], [214, 70, 30], [120, 16, 24], [176, 30, 38]];

/** 2x2 atlas of red Japanese maple foliage on fine twigs. */
export const mapleClusterTexture = (): THREE.DataTexture => {
  const context = createCanvas(1024, 1024);
  const rng = createRng(21);
  eachCell(context, 2, 2, (cell, x0, y0, size) => {
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const radius = size * 0.38;
    const twigs = drawTwigs(context, cx, cy, radius, rng, "rgb(70,30,26)", size * 0.012);
    for (let leaf = 0; leaf < 46; leaf += 1) {
      let x: number;
      let y: number;
      if (rng.next() < 0.6) {
        const [tx, ty] = twigs[rng.int(0, twigs.length - 1)];
        x = tx + rng.gauss() * size * 0.06;
        y = ty + rng.gauss() * size * 0.06;
      } else {
        const angle = rng.range(0, TAU);
        const reach = Math.sqrt(rng.next()) * radius;
        x = cx + Math.cos(angle) * reach;
        y = cy + Math.sin(angle) * reach;
      }
      const leafSize = size * rng.range(0.05, 0.085);
      const red = MAPLE_REDS[(rng.int(0, 4) + cell) % MAPLE_REDS.length];
      const shade = rng.range(0.8, 1.15);
      context.save();
      context.translate(x, y);
      context.rotate(rng.range(0, TAU));
      context.scale(1, rng.range(0.6, 1));
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, leafSize);
      gradient.addColorStop(0, css(red, shade * 0.8));
      gradient.addColorStop(1, css([Math.min(255, red[0] * 1.15), red[1] * 1.2, red[2]], shade));
      mapleLeafPath(context, leafSize, 7);
      context.fillStyle = gradient;
      context.fill();
      context.strokeStyle = css(red, 0.55, 0.5);
      context.lineWidth = 1;
      for (let vein = 0; vein < 7; vein += 1) {
        const angle = -Math.PI / 2 - Math.PI * 0.8 + (vein / 6) * Math.PI * 1.6;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(Math.cos(angle) * leafSize * 0.8, Math.sin(angle) * leafSize * 0.8);
        context.stroke();
      }
      context.restore();
    }
  });
  return toTexture(context);
};

/** 2x2 atlas of pine needle tufts seen from above. */
export const pineTuftTexture = (): THREE.DataTexture => {
  const context = createCanvas(512, 512);
  const rng = createRng(31);
  eachCell(context, 2, 2, (cell, x0, y0, size) => {
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    for (let tuft = 0; tuft < 5 + cell; tuft += 1) {
      const angle = rng.range(0, TAU);
      const offset = rng.range(0, size * 0.22);
      const x = cx + Math.cos(angle) * offset;
      const y = cy + Math.sin(angle) * offset;
      const reach = size * rng.range(0.14, 0.22);
      for (let needle = 0; needle < 70; needle += 1) {
        const direction = rng.range(0, TAU);
        const length = reach * rng.range(0.6, 1);
        const shade = rng.range(0.7, 1.3);
        const ex = x + Math.cos(direction) * length;
        const ey = y + Math.sin(direction) * length * 0.8;
        context.strokeStyle = css([28, 52, 26], shade, 0.95);
        context.lineWidth = rng.range(0.8, 1.6);
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(ex, ey);
        context.stroke();
        context.strokeStyle = css([88, 118, 52], shade, 0.9);
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x + Math.cos(direction) * length * 0.7, y + Math.sin(direction) * length * 0.56);
        context.lineTo(ex, ey);
        context.stroke();
      }
    }
  });
  return toTexture(context);
};

/**
 * Four tree silhouettes side by side for the distant forest: two cedars, a broadleaf and a
 * broadleaf in blossom. Each column is a 1:2 card with the trunk base at the bottom centre.
 */
export const forestTreeTexture = (): THREE.DataTexture => {
  const context = createCanvas(1024, 512);
  const rng = createRng(41);
  eachCell(context, 4, 1, (cell, x0, _y0, width, height) => {
    const cx = x0 + width / 2;
    context.lineCap = "round";
    if (cell < 2) {
      context.strokeStyle = "rgb(52,38,30)";
      context.lineWidth = width * 0.035;
      context.beginPath();
      context.moveTo(cx, height);
      context.lineTo(cx, height * 0.08);
      context.stroke();
      const layers = 40;
      for (let layer = 0; layer < layers; layer += 1) {
        const u = layer / (layers - 1);
        const y = height * (0.95 - u * 0.88);
        const halfWidth = width * (cell === 0 ? 0.44 : 0.36) * Math.pow(1 - u, 0.8) * rng.range(0.7, 1.15) + width * 0.03;
        for (const side of [-1, 1]) {
          for (let spray = 0; spray < 24; spray += 1) {
            const v = spray / 24;
            const sx = cx + side * halfWidth * v * 0.2;
            const ex = cx + side * halfWidth * (0.3 + 0.7 * rng.next());
            const droop = height * 0.03 * (1 - u * 0.6);
            const sy = y + rng.range(-height * 0.014, height * 0.014);
            const shade = rng.range(0.6, 1.2) * (0.7 + 0.4 * v) * (0.8 + 0.3 * u);
            context.strokeStyle = css([22, 40, 30], shade, 0.92);
            context.lineWidth = rng.range(1.2, 3.4);
            context.beginPath();
            context.moveTo(sx, sy);
            context.quadraticCurveTo((sx + ex) / 2, sy - droop * 0.2, ex, sy + droop * rng.range(0.3, 1.2));
            context.stroke();
          }
        }
      }
      return;
    }
    context.strokeStyle = "rgb(46,36,30)";
    for (let limb = 0; limb < 5; limb += 1) {
      context.lineWidth = width * 0.03 * (1 - limb * 0.12);
      context.beginPath();
      context.moveTo(cx, height);
      context.quadraticCurveTo(cx + rng.range(-20, 20), height * 0.6, cx + rng.range(-width * 0.3, width * 0.3), height * rng.range(0.25, 0.45));
      context.stroke();
    }
    const greens: Rgb[] = cell === 2 ? [[34, 58, 26], [58, 84, 34], [90, 108, 44]] : [[30, 52, 30], [52, 76, 40], [120, 116, 60]];
    for (let clump = 0; clump < 70; clump += 1) {
      const angle = rng.range(0, TAU);
      const reach = Math.sqrt(rng.next());
      const x = cx + Math.cos(angle) * reach * width * 0.36;
      const y = height * 0.36 + Math.sin(angle) * reach * height * 0.24 - (1 - reach) * height * 0.04;
      const spread = width * rng.range(0.09, 0.16);
      for (let leaf = 0; leaf < 55; leaf += 1) {
        const leafAngle = rng.range(0, TAU);
        const leafReach = Math.sqrt(rng.next()) * spread;
        const lx = x + Math.cos(leafAngle) * leafReach;
        const ly = y + Math.sin(leafAngle) * leafReach;
        const lit = 1 - (ly - height * 0.1) / (height * 0.55);
        const green = greens[Math.min(2, Math.floor(rng.next() * 2 + lit * 1.2))];
        context.fillStyle = css(green, rng.range(0.75, 1.15));
        context.beginPath();
        context.ellipse(lx, ly, width * 0.014, width * 0.008, rng.range(0, 3), 0, TAU);
        context.fill();
      }
    }
    if (cell !== 3) return;
    for (let blossom = 0; blossom < 120; blossom += 1) {
      const angle = rng.range(0, TAU);
      const reach = Math.sqrt(rng.next());
      context.fillStyle = "rgba(236,196,204,0.95)";
      context.beginPath();
      context.arc(cx + Math.cos(angle) * reach * width * 0.33, height * 0.34 + Math.sin(angle) * reach * height * 0.2, width * 0.01, 0, TAU);
      context.fill();
    }
  });
  return toTexture(context);
};

/** Elliptic citrus leaf with a pointed tip, from its stalk at the origin along +x. */
const citrusLeafPath = (context: CanvasRenderingContext2D, length: number, width: number): void => {
  context.beginPath();
  context.moveTo(0, 0);
  context.bezierCurveTo(length * 0.22, -width * 0.62, length * 0.72, -width * 0.56, length, 0);
  context.bezierCurveTo(length * 0.72, width * 0.56, length * 0.22, width * 0.62, 0, 0);
  context.closePath();
};

const CITRUS_GREENS: Rgb[] = [[30, 66, 28], [40, 80, 34], [26, 58, 26], [48, 90, 38]];

/** 2x2 atlas of glossy citrus foliage on fine twigs; the last cell carries a few white blossoms. */
export const citrusClusterTexture = (): THREE.DataTexture => {
  const context = createCanvas(1024, 1024);
  const rng = createRng(47);
  eachCell(context, 2, 2, (cell, x0, y0, size) => {
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const radius = size * 0.38;
    const twigs = drawTwigs(context, cx, cy, radius, rng, "rgb(54,58,34)", size * 0.014);
    for (let leaf = 0; leaf < 40; leaf += 1) {
      let x: number;
      let y: number;
      if (rng.next() < 0.65) {
        const [tx, ty] = twigs[rng.int(0, twigs.length - 1)];
        x = tx + rng.gauss() * size * 0.04;
        y = ty + rng.gauss() * size * 0.04;
      } else {
        const angle = rng.range(0, TAU);
        const reach = Math.sqrt(rng.next()) * radius;
        x = cx + Math.cos(angle) * reach;
        y = cy + Math.sin(angle) * reach;
      }
      const length = size * rng.range(0.11, 0.16);
      const width = length * rng.range(0.4, 0.5);
      const green = CITRUS_GREENS[(rng.int(0, 3) + cell) % CITRUS_GREENS.length];
      const underside = rng.next() < 0.18;
      const shade = rng.range(0.82, 1.18) * (underside ? 1.45 : 1);
      context.save();
      context.translate(x, y);
      context.rotate(rng.range(0, TAU));
      context.scale(1, rng.range(0.7, 1));
      const gradient = context.createLinearGradient(0, 0, length, 0);
      gradient.addColorStop(0, css(green, shade * 0.8));
      gradient.addColorStop(0.6, css(green, shade * 1.08));
      gradient.addColorStop(1, css(green, shade * 0.95));
      citrusLeafPath(context, length, width);
      context.fillStyle = gradient;
      context.fill();
      context.strokeStyle = css([120, 150, 70], underside ? 1 : 0.8, 0.7);
      context.lineWidth = Math.max(1, size * 0.004);
      context.beginPath();
      context.moveTo(length * 0.04, 0);
      context.quadraticCurveTo(length * 0.5, width * 0.04, length * 0.94, 0);
      context.stroke();
      if (!underside) {
        context.strokeStyle = "rgba(235,245,220,0.28)";
        context.lineWidth = Math.max(1, width * 0.12);
        context.beginPath();
        context.moveTo(length * 0.25, -width * 0.18);
        context.quadraticCurveTo(length * 0.55, -width * 0.26, length * 0.8, -width * 0.12);
        context.stroke();
      }
      context.restore();
    }
    if (cell !== 3) return;
    for (let flower = 0; flower < 3; flower += 1) {
      const [x, y] = twigs[rng.int(0, twigs.length - 1)];
      const petal = size * rng.range(0.018, 0.024);
      context.fillStyle = "rgb(250,248,238)";
      for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * TAU + rng.next() * 0.3;
        context.beginPath();
        context.ellipse(x + Math.cos(angle) * petal * 0.8, y + Math.sin(angle) * petal * 0.8, petal, petal * 0.42, angle, 0, TAU);
        context.fill();
      }
      context.fillStyle = "rgb(236,206,96)";
      context.beginPath();
      context.arc(x, y, petal * 0.4, 0, TAU);
      context.fill();
    }
  });
  return toTexture(context);
};

/** Ovate leaflet with teeth pointing to its tip, from its stalk at the origin along +x. */
const leafletPath = (context: CanvasRenderingContext2D, length: number, width: number, teeth: number, phase: number): void => {
  const steps = teeth * 4;
  const half = (t: number, side: number): number => {
    const body = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.9);
    const saw = 0.86 + 0.14 * ((t * teeth + phase + (side > 0 ? 0.5 : 0)) % 1);
    const lobe = 1 + 0.1 * Math.sin(t * Math.PI * 2.2 + side);
    return width * 0.5 * body * saw * lobe;
  };
  context.beginPath();
  context.moveTo(0, 0);
  for (let step = 1; step <= steps; step += 1) context.lineTo((step / steps) * length, -half(step / steps, -1));
  for (let step = steps - 1; step >= 1; step -= 1) context.lineTo((step / steps) * length, half(step / steps, 1));
  context.closePath();
};

const TOMATO_GREENS: Rgb[] = [[52, 92, 36], [44, 82, 32], [60, 100, 40]];

/** Pinnate tomato leaf whose petiole starts at the bottom centre of the cell and runs up it. */
const drawTomatoLeaf = (context: CanvasRenderingContext2D, x0: number, y0: number, size: number, rng: Rng, young: boolean): void => {
  const base: [number, number] = [x0 + size * 0.5, y0 + size];
  const bend: [number, number] = [base[0] + rng.range(-0.08, 0.08) * size, y0 + size * 0.66];
  const tip: [number, number] = [base[0] + rng.range(-0.05, 0.05) * size, y0 + size * 0.34];
  const at = (t: number): [number, number] => [
    (1 - t) * (1 - t) * base[0] + 2 * (1 - t) * t * bend[0] + t * t * tip[0],
    (1 - t) * (1 - t) * base[1] + 2 * (1 - t) * t * bend[1] + t * t * tip[1]
  ];
  const green: Rgb = young ? [80, 126, 50] : TOMATO_GREENS[rng.int(0, TOMATO_GREENS.length - 1)];
  context.lineCap = "round";
  context.strokeStyle = css(green, 0.9);
  for (let step = 0; step < 16; step += 1) {
    const [ax, ay] = at(step / 16);
    const [bx, by] = at((step + 1) / 16);
    context.lineWidth = size * (0.02 - 0.011 * (step / 16));
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(bx, by);
    context.stroke();
  }
  const leaflet = (x: number, y: number, angle: number, length: number, width: number, shade: number): void => {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.strokeStyle = css(green, 0.85);
    context.lineWidth = Math.max(1, size * 0.008);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(length * 0.08, 0);
    context.stroke();
    context.translate(length * 0.06, 0);
    const gradient = context.createLinearGradient(0, -width * 0.5, 0, width * 0.5);
    gradient.addColorStop(0, css(green, shade * 0.88));
    gradient.addColorStop(0.45, css(green, shade * 1.14));
    gradient.addColorStop(1, css(green, shade * 0.8));
    leafletPath(context, length, width, rng.int(5, 7), rng.next());
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = css([150, 182, 104], 1, 0.45);
    context.lineWidth = Math.max(1, size * 0.005);
    context.beginPath();
    context.moveTo(length * 0.02, 0);
    context.quadraticCurveTo(length * 0.5, width * 0.04, length * 0.9, 0);
    context.stroke();
    context.strokeStyle = css(green, 0.7, 0.35);
    context.lineWidth = 1;
    for (let vein = 1; vein <= 4; vein += 1) {
      for (const side of [-1, 1]) {
        context.beginPath();
        context.moveTo(length * (vein / 5), 0);
        context.lineTo(length * (vein / 5 + 0.12), side * width * 0.34);
        context.stroke();
      }
    }
    context.restore();
  };
  const pairs = young ? 2 : 3;
  for (let pair = 0; pair < pairs; pair += 1) {
    const t = 0.3 + (pair / pairs) * 0.55;
    const [x, y] = at(t);
    const [nx, ny] = at(t + 0.02);
    const along = Math.atan2(ny - y, nx - x);
    for (const side of [-1, 1]) {
      const length = size * rng.range(0.2, 0.25) * (0.85 + 0.25 * t);
      leaflet(x, y, along + side * rng.range(0.85, 1.15), length, length * rng.range(0.5, 0.6), rng.range(0.85, 1.1));
    }
    if (young) continue;
    const [ix, iy] = at(t + 0.09);
    for (const side of [-1, 1]) leaflet(ix, iy, along + side * 1.3, size * 0.06, size * 0.035, 0.95);
  }
  const [tx, ty] = at(1);
  const [px, py] = at(0.97);
  leaflet(tx, ty, Math.atan2(ty - py, tx - px), size * 0.28, size * 0.16, 1.05);
};

/** Tomato truss: a zig-zag of yellow star flowers, buds at its tip, rising from the bottom centre. */
const drawTomatoTruss = (context: CanvasRenderingContext2D, x0: number, y0: number, size: number, rng: Rng): void => {
  const stalk = css([86, 122, 50]);
  context.lineCap = "round";
  context.strokeStyle = stalk;
  context.lineWidth = size * 0.02;
  const start: [number, number] = [x0 + size * 0.5, y0 + size];
  let cursor: [number, number] = [start[0] + size * 0.02, y0 + size * 0.55];
  context.beginPath();
  context.moveTo(start[0], start[1]);
  context.quadraticCurveTo(start[0] - size * 0.04, y0 + size * 0.8, cursor[0], cursor[1]);
  context.stroke();
  const flowers: Array<[number, number]> = [];
  for (let node = 0; node < 6; node += 1) {
    const side = node % 2 ? 1 : -1;
    const next: [number, number] = [cursor[0] + side * size * rng.range(0.06, 0.1), cursor[1] - size * rng.range(0.06, 0.08)];
    context.lineWidth = size * (0.016 - node * 0.002);
    context.beginPath();
    context.moveTo(cursor[0], cursor[1]);
    context.lineTo(next[0], next[1]);
    context.stroke();
    const flower: [number, number] = [next[0] + side * size * 0.08, next[1] - size * 0.03];
    context.lineWidth = Math.max(1, size * 0.007);
    context.beginPath();
    context.moveTo(next[0], next[1]);
    context.lineTo(flower[0], flower[1]);
    context.stroke();
    flowers.push(flower);
    cursor = next;
  }
  flowers.forEach(([x, y], index) => {
    if (index >= 4) {
      context.fillStyle = css([196, 200, 92]);
      context.beginPath();
      context.ellipse(x, y, size * 0.018, size * 0.03, rng.range(-0.5, 0.5), 0, TAU);
      context.fill();
      return;
    }
    const turn = rng.range(0, TAU);
    context.fillStyle = css([74, 112, 42]);
    for (let sepal = 0; sepal < 6; sepal += 1) {
      const angle = turn + (sepal / 6) * TAU + TAU / 12;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + Math.cos(angle - 0.12) * size * 0.02, y + Math.sin(angle - 0.12) * size * 0.02);
      context.lineTo(x + Math.cos(angle) * size * 0.06, y + Math.sin(angle) * size * 0.06);
      context.lineTo(x + Math.cos(angle + 0.12) * size * 0.02, y + Math.sin(angle + 0.12) * size * 0.02);
      context.fill();
    }
    for (let petal = 0; petal < 6; petal += 1) {
      const angle = turn + (petal / 6) * TAU;
      const gradient = context.createLinearGradient(x, y, x + Math.cos(angle) * size * 0.075, y + Math.sin(angle) * size * 0.075);
      gradient.addColorStop(0, css([232, 184, 40]));
      gradient.addColorStop(1, css([250, 222, 70]));
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(x + Math.cos(angle - 0.4) * size * 0.012, y + Math.sin(angle - 0.4) * size * 0.012);
      context.lineTo(x + Math.cos(angle) * size * 0.075, y + Math.sin(angle) * size * 0.075);
      context.lineTo(x + Math.cos(angle + 0.4) * size * 0.012, y + Math.sin(angle + 0.4) * size * 0.012);
      context.fill();
    }
    context.fillStyle = css([226, 170, 30]);
    context.beginPath();
    context.arc(x, y, size * 0.018, 0, TAU);
    context.fill();
  });
};

/**
 * 2x2 atlas for tomato plants: two mature compound leaves, a young leaf and a flower truss.
 * Every cell starts at its bottom centre, where the card meets the stem.
 */
export const tomatoLeafTexture = (): THREE.DataTexture => {
  const context = createCanvas(512, 512);
  const rng = createRng(83);
  eachCell(context, 2, 2, (cell, x0, y0, size) => {
    if (cell === 3) drawTomatoTruss(context, x0, y0, size, rng);
    else drawTomatoLeaf(context, x0, y0, size, rng, cell === 2);
  });
  return toTexture(context);
};

/**
 * Tileable straw mulch: overlapping stalks in golden and weathered grey, with gaps where the soil
 * shows through the alpha. Repeats seamlessly.
 */
export const strawTexture = (): THREE.DataTexture => {
  const size = 512;
  const context = createCanvas(size, size);
  const rng = createRng(97);
  const straws: Rgb[] = [[214, 184, 118], [192, 160, 98], [168, 142, 96], [150, 132, 104], [226, 202, 140]];
  context.lineCap = "round";
  for (let stalk = 0; stalk < 2000; stalk += 1) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const angle = rng.range(-0.7, 0.7) + (rng.next() < 0.3 ? Math.PI / 2 : 0);
    const length = rng.range(24, 80);
    const dx = Math.cos(angle) * length;
    const dy = Math.sin(angle) * length;
    const bow = rng.range(-6, 6);
    const color = straws[rng.int(0, straws.length - 1)];
    const light = rng.range(0.7, 1.15);
    const width = rng.range(1.4, 3.2);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx + Math.abs(dx) < -4 || sx - Math.abs(dx) > size + 4 || sy + Math.abs(dy) < -4 || sy - Math.abs(dy) > size + 4) continue;
        context.strokeStyle = css(color, light * 0.6);
        context.lineWidth = width + 1;
        context.beginPath();
        context.moveTo(sx, sy);
        context.quadraticCurveTo(sx + dx / 2 - (dy / length) * bow, sy + dy / 2 + (dx / length) * bow, sx + dx, sy + dy);
        context.stroke();
        context.strokeStyle = css(color, light);
        context.lineWidth = width;
        context.stroke();
      }
    }
  }
  const texture = toTexture(context);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

/** 2x2 atlas of shrub foliage: two plain leaf masses and two azaleas in flower. */
export const shrubTexture = (): THREE.DataTexture => {
  const context = createCanvas(512, 512);
  const rng = createRng(61);
  eachCell(context, 2, 2, (cell, x0, y0, size) => {
    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    for (let leaf = 0; leaf < 90; leaf += 1) {
      const angle = rng.range(0, TAU);
      const reach = Math.sqrt(rng.next()) * size * 0.42;
      const shade = rng.range(0.7, 1.25);
      context.save();
      context.translate(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
      context.rotate(rng.range(0, TAU));
      const gradient = context.createLinearGradient(-size * 0.04, 0, size * 0.04, 0);
      gradient.addColorStop(0, css([30, 62, 26], shade));
      gradient.addColorStop(1, css([70, 110, 44], shade));
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(0, 0, size * 0.045, size * 0.02, 0, 0, TAU);
      context.fill();
      context.restore();
    }
    if (cell < 2) return;
    const palette: BlossomPalette = cell === 2
      ? { tip: [250, 150, 196], mid: [236, 92, 150], base: [200, 50, 110], eye: [150, 20, 70] }
      : { tip: [255, 214, 226], mid: [246, 160, 190], base: [226, 110, 150], eye: [170, 40, 80] };
    for (let flower = 0; flower < 16; flower += 1) {
      const angle = rng.range(0, TAU);
      const reach = Math.sqrt(rng.next()) * size * 0.38;
      drawBlossom(context, cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach, size * rng.range(0.05, 0.07), rng, palette);
    }
  });
  return toTexture(context);
};

/** Three meadow flower kinds side by side (daisy, buttercup, bellflower), stems rooted at the bottom. */
export const meadowFlowerTexture = (): THREE.DataTexture => {
  const context = createCanvas(384, 128);
  const rng = createRng(5);
  const kinds: Array<[string, string]> = [["#f4f1e6", "#e3c75a"], ["#f2c93a", "#c9892a"], ["#8f74c8", "#f0d65a"]];
  eachCell(context, 3, 1, (cell, x0, _y0, size) => {
    const [petal, centre] = kinds[cell];
    for (let stem = 0; stem < 5; stem += 1) {
      const x = x0 + size * (0.2 + 0.6 * rng.next());
      const y = size * (0.12 + 0.35 * rng.next());
      context.strokeStyle = "#3d5a22";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, y);
      context.quadraticCurveTo(x + rng.range(-10, 10), size * 0.7, x0 + size * 0.5 + rng.range(-8, 8), size);
      context.stroke();
      const radius = size * rng.range(0.05, 0.08);
      context.fillStyle = petal;
      for (let index = 0; index < 6; index += 1) {
        const angle = index * 1.047 + rng.next();
        context.beginPath();
        context.ellipse(x + Math.cos(angle) * radius * 0.7, y + Math.sin(angle) * radius * 0.55, radius * 0.55, radius * 0.28, angle, 0, TAU);
        context.fill();
      }
      context.fillStyle = centre;
      context.beginPath();
      context.arc(x, y, radius * 0.28, 0, TAU);
      context.fill();
    }
  });
  return toTexture(context);
};

/** Two fern fronds side by side, rachis rising from the bottom centre of each 1:2 column. */
export const fernTexture = (): THREE.DataTexture => {
  const context = createCanvas(512, 512);
  const rng = createRng(77);
  eachCell(context, 2, 1, (cell, x0, _y0, width, height) => {
    const base: [number, number] = [x0 + width / 2, height];
    const tip: [number, number] = [x0 + width * (cell === 0 ? 0.58 : 0.42), height * 0.04];
    const bend = width * (cell === 0 ? 0.12 : -0.1);
    const at = (t: number): [number, number] => {
      const x = (1 - t) * (1 - t) * base[0] + 2 * (1 - t) * t * (base[0] + bend) + t * t * tip[0];
      const y = (1 - t) * (1 - t) * base[1] + 2 * (1 - t) * t * (height * 0.5) + t * t * tip[1];
      return [x, y];
    };
    context.strokeStyle = "rgb(62,84,34)";
    context.lineCap = "round";
    context.lineWidth = width * 0.02;
    context.beginPath();
    for (let step = 0; step <= 24; step += 1) {
      const [x, y] = at(step / 24);
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    const pairs = 22;
    for (let pair = 2; pair < pairs; pair += 1) {
      const t = pair / pairs;
      const [x, y] = at(t);
      const [nx, ny] = at(Math.min(1, t + 0.02));
      const along = Math.atan2(ny - y, nx - x);
      const length = width * 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.08)) * (1 - t * 0.35);
      for (const side of [-1, 1]) {
        const angle = along + side * (Math.PI / 2 - 0.35);
        const leaflets = 7;
        for (let leaflet = 1; leaflet <= leaflets; leaflet += 1) {
          const u = leaflet / leaflets;
          const lx = x + Math.cos(angle) * length * u;
          const ly = y + Math.sin(angle) * length * u + u * u * width * 0.03;
          const shade = rng.range(0.85, 1.15) * (0.8 + 0.3 * t);
          context.fillStyle = css([64, 104, 38], shade);
          context.beginPath();
          context.ellipse(lx, ly, length * 0.09 * (1.1 - u * 0.5), length * 0.045, angle + side * 0.6, 0, TAU);
          context.fill();
        }
      }
    }
  });
  return toTexture(context);
};
