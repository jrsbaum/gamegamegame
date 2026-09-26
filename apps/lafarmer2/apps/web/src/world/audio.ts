export type Surface = "grass" | "wood" | "dirt" | "water";

export type SoundState = {
  /** 0 by day, 1 at night. */
  night: number;
  /** 1 on the bank, 0 far from the river. */
  nearWater: number;
  /** 0 calm, 1 gusty. */
  wind: number;
  /** Player speed in world units per second. */
  speed: number;
  surface: Surface;
};

export type Soundscape = {
  /** Call from the first user gesture: the AudioContext is created and started here, never earlier. */
  resume: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
  update: (dt: number, state: SoundState) => void;
  /** One step; intensity 0..1 (a sprint is louder and brighter). */
  footstep: (surface: Surface, intensity: number) => void;
  dispose: () => void;
};

export type SoundscapeOptions = {
  /** Render into this context instead (e.g. an OfflineAudioContext); it is never resumed, suspended or closed here. */
  context?: BaseAudioContext;
  random?: () => number;
};

/** The two compressors add about 10 dB of automatic make-up gain; the layer levels below account for it. */
const MASTER_VOLUME = 0.5;
/** Events are queued this far ahead on the audio clock, so frame hitches never delay them. */
const LOOKAHEAD = 0.3;
const LEVEL_INTERVAL = 0.1;
const SPRINT_SPEED = 7;
const PAD_LEVEL = 0.018;
const PAN_POSITIONS = [-0.8, -0.45, -0.15, 0.15, 0.45, 0.8];

type Engine = {
  update: (dt: number, state: SoundState) => void;
  footstep: (surface: Surface, intensity: number) => void;
  setVolume: (volume: number) => void;
  stop: () => void;
};

type Envelope = { time: number; attack: number; decay: number; level: number };
type Note = { at: number; length: number; from: number; to: number; level: number; attack?: number };
type Clock = { next: number };
type NoiseColor = "white" | "pink" | "brown";

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const createEngine = (context: BaseAudioContext, random: () => number, volume: number): Engine => {
  const now = (): number => context.currentTime;
  const between = (low: number, high: number): number => low + (high - low) * random();
  const pick = <T>(items: ReadonlyArray<T>): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  /** Waiting time until the next event of a random process with this mean interval. */
  const wait = (mean: number): number => -Math.log(1 - random() * 0.995) * mean;

  const gainNode = (value: number): GainNode => {
    const node = context.createGain();
    node.gain.value = value;
    return node;
  };
  const filterNode = (type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode => {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  const pannerNode = (pan: number): AudioNode => {
    if (typeof context.createStereoPanner !== "function") return gainNode(1);
    const node = context.createStereoPanner();
    node.pan.value = pan;
    return node;
  };
  const chain = (...nodes: AudioNode[]): void => {
    for (let index = 1; index < nodes.length; index += 1) nodes[index - 1].connect(nodes[index]);
  };
  const glide = (param: AudioParam, value: number, seconds: number, time = now()): void => {
    param.setTargetAtTime(value, time, seconds);
  };
  const release = (source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void => {
    source.onended = () => {
      for (const node of nodes) node.disconnect();
    };
  };

  const master = gainNode(volume);
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 12;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.02;
  compressor.release.value = 0.3;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  chain(master, compressor, limiter, context.destination);

  /** Loopable noise: the tail is cross-faded into the head so the loop point never clicks. */
  const noise = (seconds: number, color: NoiseColor, channels: number): AudioBuffer => {
    const length = Math.floor(context.sampleRate * seconds);
    const fade = Math.floor(context.sampleRate * 0.05);
    const buffer = context.createBuffer(channels, length, context.sampleRate);
    const scratch = new Float32Array(length + fade);
    for (let channel = 0; channel < channels; channel += 1) {
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let brown = 0;
      for (let index = 0; index < scratch.length; index += 1) {
        const white = random() * 2 - 1;
        if (color === "white") {
          scratch[index] = white;
        } else if (color === "pink") {
          b0 = 0.99765 * b0 + white * 0.099046;
          b1 = 0.963 * b1 + white * 0.2965164;
          b2 = 0.57 * b2 + white * 1.0526913;
          scratch[index] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
        } else {
          brown = (brown + 0.02 * white) / 1.02;
          scratch[index] = brown * 3.5;
        }
      }
      for (let index = 0; index < fade; index += 1) {
        const t = index / fade;
        scratch[index] = scratch[index] * t + scratch[length + index] * (1 - t);
      }
      buffer.getChannelData(channel).set(scratch.subarray(0, length));
    }
    return buffer;
  };

  const whiteNoise = noise(3, "white", 2);
  const pinkNoise = noise(5, "pink", 2);
  const brownNoise = noise(5, "brown", 2);
  const grainNoise = noise(1, "white", 1);
  const continuous: AudioScheduledSourceNode[] = [];
  const loop = (buffer: AudioBuffer): AudioBufferSourceNode => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start(now(), random() * buffer.duration);
    continuous.push(source);
    return source;
  };
  const oscillator = (type: OscillatorType, frequency: number): OscillatorNode => {
    const node = context.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.start(now());
    continuous.push(node);
    return node;
  };
  const white = loop(whiteNoise);
  const pink = loop(pinkNoise);
  const brown = loop(brownNoise);

  const ambience = gainNode(1);
  const steps = gainNode(0.55);
  chain(ambience, master);
  chain(steps, master);

  // a short, dark valley echo for the calls of animals
  const echoSend = gainNode(1);
  const echoDelay = context.createDelay(1);
  echoDelay.delayTime.value = 0.27;
  const echoTone = filterNode("lowpass", 2200);
  const echoFeedback = gainNode(0.3);
  const echoReturn = gainNode(0.3);
  chain(echoSend, echoDelay, echoTone, echoFeedback, echoDelay);
  chain(echoTone, echoReturn, ambience);
  const pans = (destination: AudioNode, echo: number): AudioNode[] => {
    const send = gainNode(echo);
    if (echo > 0) chain(send, echoSend);
    return PAN_POSITIONS.map((pan) => {
      const node = pannerNode(pan);
      node.connect(destination);
      if (echo > 0) node.connect(send);
      return node;
    });
  };

  const river = gainNode(0);
  chain(river, ambience);
  const flowTone = filterNode("lowpass", 460, 0.6);
  chain(brown, flowTone, gainNode(0.12), river);
  const babble = [
    { frequency: 640, q: 2.2, level: 0.28 },
    { frequency: 1300, q: 2.8, level: 0.2 },
    { frequency: 2600, q: 3.2, level: 0.11 }
  ].map((band) => {
    const filter = filterNode("bandpass", band.frequency, band.q);
    const level = gainNode(band.level);
    chain(pink, filter, level, river);
    return { ...band, filter, gain: level };
  });
  chain(white, filterNode("highpass", 5200, 0.5), gainNode(0.009), river);
  const bubbles = pans(river, 0);

  const wind = gainNode(0);
  const gust = gainNode(0.6);
  chain(wind, gust, ambience);
  const windBody = filterNode("bandpass", 520, 0.55);
  chain(pink, windBody, gainNode(0.45), wind);
  const leaves = gainNode(0.02);
  chain(white, filterNode("bandpass", 4200, 0.7), leaves, wind);

  const birds = gainNode(0);
  chain(birds, filterNode("lowpass", 7500), gainNode(0.5), ambience);
  const birdPans = pans(birds, 0.35);

  const night = gainNode(0);
  chain(night, ambience);
  const nightPans = pans(night, 0.25);
  for (const chorus of [{ frequency: 4300, rate: 23 }, { frequency: 5100, rate: 31 }]) {
    const tremolo = gainNode(0.5);
    chain(white, filterNode("bandpass", chorus.frequency, 9), tremolo, gainNode(0.15), night);
    const depth = gainNode(0.5);
    chain(oscillator("sine", chorus.rate), depth);
    depth.connect(tremolo.gain);
  }

  const pad = gainNode(0);
  const breath = gainNode(1);
  chain(breath, pad, filterNode("lowpass", 1100, 0.5), ambience);
  const breathDepth = gainNode(0.35);
  chain(oscillator("sine", 0.045), breathDepth);
  breathDepth.connect(breath.gain);
  for (const frequency of [146.83, 220, 329.63, 369.99]) {
    chain(oscillator("sine", frequency), gainNode(0.18), breath);
    const warm = oscillator("triangle", frequency);
    warm.detune.value = 5;
    chain(warm, gainNode(0.1), breath);
  }

  const swishBand = filterNode("bandpass", 3000, 0.9);
  const swish = gainNode(0);
  chain(white, swishBand, swish, steps);

  const envelope = ({ time, attack, decay, level }: Envelope): GainNode => {
    const node = context.createGain();
    node.gain.setValueAtTime(0, time);
    node.gain.linearRampToValueAtTime(level, time + attack);
    node.gain.exponentialRampToValueAtTime(level * 0.001 + 1e-6, time + attack + decay);
    return node;
  };

  const burst = (destination: AudioNode, shape: Envelope & { type: BiquadFilterType; frequency: number; q: number; sweep?: number }): void => {
    const length = shape.attack + shape.decay + 0.02;
    const source = context.createBufferSource();
    source.buffer = grainNoise;
    const filter = filterNode(shape.type, shape.frequency, shape.q);
    if (shape.sweep) {
      filter.frequency.setValueAtTime(shape.frequency, shape.time);
      filter.frequency.exponentialRampToValueAtTime(shape.sweep, shape.time + length);
    }
    const gain = envelope(shape);
    chain(source, filter, gain, destination);
    source.start(shape.time, random() * Math.max(0, grainNoise.duration - length), length);
    release(source, filter, gain);
  };

  const tone = (destination: AudioNode, shape: Envelope & { wave: OscillatorType; from: number; to: number }): void => {
    const source = context.createOscillator();
    source.type = shape.wave;
    source.frequency.setValueAtTime(shape.from, shape.time);
    source.frequency.exponentialRampToValueAtTime(shape.to, shape.time + shape.attack + shape.decay);
    const gain = envelope(shape);
    chain(source, gain, destination);
    source.start(shape.time);
    source.stop(shape.time + shape.attack + shape.decay + 0.02);
    release(source, gain);
  };

  /** A sung phrase on one oscillator: each note glides from `from` to `to` under its own envelope. */
  const phrase = (destination: AudioNode, time: number, notes: ReadonlyArray<Note>, warble?: { rate: number; depth: number }): void => {
    const source = context.createOscillator();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    let end = time;
    for (const note of notes) {
      const start = time + note.at;
      const stop = start + note.length;
      const attack = note.attack ?? Math.min(0.012, note.length * 0.3);
      source.frequency.setValueAtTime(note.from, start);
      source.frequency.exponentialRampToValueAtTime(note.to, stop);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(note.level, start + attack);
      gain.gain.linearRampToValueAtTime(note.level * 0.7, stop - Math.min(0.015, note.length * 0.3));
      gain.gain.linearRampToValueAtTime(0, stop);
      end = Math.max(end, stop);
    }
    chain(source, gain, destination);
    source.start(time);
    source.stop(end + 0.05);
    if (!warble) {
      release(source, gain);
      return;
    }
    const vibrato = context.createOscillator();
    vibrato.frequency.value = warble.rate;
    const depth = gainNode(warble.depth);
    chain(vibrato, depth);
    depth.connect(source.frequency);
    vibrato.start(time);
    vibrato.stop(end + 0.05);
    release(source, gain, depth);
  };

  const songs: ReadonlyArray<{ weight: number; sing: (time: number, destination: AudioNode) => void }> = [
    {
      // uguisu: a long rising whistle, then a quick "ho-ke-kyo"
      weight: 0.28,
      sing: (time, destination) => {
        const pitch = between(0.93, 1.07);
        const hold = between(0.8, 1.3);
        phrase(destination, time, [
          { at: 0, length: hold, from: 1080 * pitch, to: 1260 * pitch, level: 0.09, attack: hold * 0.35 },
          { at: hold + 0.14, length: 0.09, from: 2150 * pitch, to: 2350 * pitch, level: 0.11 },
          { at: hold + 0.26, length: 0.08, from: 1700 * pitch, to: 2700 * pitch, level: 0.1 },
          { at: hold + 0.37, length: 0.3, from: 3000 * pitch, to: 1900 * pitch, level: 0.12 }
        ], { rate: 7, depth: 12 * pitch });
      }
    },
    {
      // sparrow: a few buzzy falling chirps
      weight: 0.25,
      sing: (time, destination) => {
        const pitch = between(0.9, 1.1);
        const notes: Note[] = [];
        let at = 0;
        for (let chirp = 2 + Math.floor(random() * 4); chirp > 0; chirp -= 1) {
          const length = between(0.05, 0.08);
          notes.push({ at, length, from: 5200 * pitch * between(0.95, 1.05), to: 3500 * pitch, level: 0.06 * between(0.7, 1) });
          at += length + between(0.08, 0.2);
        }
        phrase(destination, time, notes, { rate: 55, depth: 280 * pitch });
      }
    },
    {
      // warbler: a fast descending trill
      weight: 0.2,
      sing: (time, destination) => {
        const count = 8 + Math.floor(random() * 9);
        const top = between(4400, 5600);
        const bottom = top * between(0.7, 0.85);
        const notes = Array.from({ length: count }, (_, index): Note => {
          const t = index / (count - 1);
          const frequency = top + (bottom - top) * t;
          return { at: index * 0.058, length: 0.032, from: frequency * 0.92, to: frequency * 1.06, level: 0.05 * (0.6 + 0.4 * Math.sin(Math.PI * t)) };
        });
        phrase(destination, time, notes);
      }
    },
    {
      // tit: "tsee-pee" repeated
      weight: 0.15,
      sing: (time, destination) => {
        const pitch = between(0.92, 1.08);
        const notes: Note[] = [];
        for (let repeat = 0, count = 3 + Math.floor(random() * 3); repeat < count; repeat += 1) {
          const at = repeat * 0.32;
          notes.push({ at, length: 0.1, from: 5600 * pitch, to: 5300 * pitch, level: 0.045 });
          notes.push({ at: at + 0.13, length: 0.12, from: 3350 * pitch, to: 3150 * pitch, level: 0.055 });
        }
        phrase(destination, time, notes);
      }
    },
    {
      // turtle dove: a soft low "coo-cooo, coo"
      weight: 0.12,
      sing: (time, destination) => {
        const pitch = between(0.92, 1.05);
        phrase(destination, time, [
          { at: 0, length: 0.32, from: 520 * pitch, to: 560 * pitch, level: 0.1, attack: 0.08 },
          { at: 0.45, length: 0.6, from: 560 * pitch, to: 470 * pitch, level: 0.14, attack: 0.12 },
          { at: 1.2, length: 0.28, from: 500 * pitch, to: 460 * pitch, level: 0.09, attack: 0.07 }
        ], { rate: 5, depth: 6 });
      }
    }
  ];
  const totalWeight = songs.reduce((sum, song) => sum + song.weight, 0);
  const sing = (time: number): void => {
    let roll = random() * totalWeight;
    for (const song of songs) {
      roll -= song.weight;
      if (roll <= 0) return song.sing(time, pick(birdPans));
    }
    songs[0].sing(time, pick(birdPans));
  };

  const crickets = Array.from({ length: 4 }, (_, index) => ({
    clock: { next: 0 },
    pitch: between(4200, 5200),
    pulses: 2 + Math.floor(random() * 3),
    period: between(0.024, 0.036),
    interval: between(0.38, 0.62),
    level: between(0.02, 0.04),
    pan: nightPans[(index * 2 + 1) % nightPans.length]
  }));
  const chirp = (cricket: (typeof crickets)[number], time: number): void => {
    const source = context.createOscillator();
    source.frequency.value = cricket.pitch;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    for (let pulse = 0; pulse < cricket.pulses; pulse += 1) {
      const start = time + pulse * cricket.period;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(cricket.level, start + cricket.period * 0.2);
      gain.gain.linearRampToValueAtTime(0, start + cricket.period * 0.65);
    }
    chain(source, gain, cricket.pan);
    source.start(time);
    source.stop(time + cricket.pulses * cricket.period + 0.02);
    release(source, gain);
  };

  const frogs = Array.from({ length: 3 }, (_, index) => ({
    clock: { next: 0 },
    pitch: between(170, 260),
    formant: between(900, 1500),
    pan: nightPans[(index * 2) % nightPans.length]
  }));
  const croak = (frog: (typeof frogs)[number], time: number, level: number): void => {
    const source = context.createOscillator();
    source.type = "sawtooth";
    const formant = filterNode("bandpass", frog.formant, 3.5);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, time);
    const spacing = between(0.13, 0.19);
    const count = 3 + Math.floor(random() * 6);
    let start = time;
    let end = time;
    for (let index = 0; index < count; index += 1) {
      const length = between(0.06, 0.1);
      source.frequency.setValueAtTime(frog.pitch * 1.08, start);
      source.frequency.exponentialRampToValueAtTime(frog.pitch * 0.92, start + length);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(level * 0.02 + 1e-6, start + length);
      gain.gain.setValueAtTime(0, start + length + 0.001);
      end = start + length;
      start += spacing * between(0.92, 1.08);
    }
    chain(source, formant, gain, frog.pan);
    source.start(time);
    source.stop(end + 0.05);
    release(source, formant, gain);
  };

  const hoot = (time: number): void => {
    const pitch = between(0.95, 1.05);
    const note = (at: number, length: number, level: number): Note => ({ at, length, from: 400 * pitch, to: 350 * pitch, level, attack: length * 0.3 });
    phrase(pick(nightPans), time, [note(0, 0.42, 0.07), note(1.05, 0.26, 0.05), note(1.4, 0.26, 0.05), note(1.75, 0.34, 0.06)], { rate: 4, depth: 3 });
  };

  const bubble = (time: number): void => {
    const size = random();
    const from = 380 + size * size * 1500;
    tone(pick(bubbles), { time, attack: 0.003, decay: between(0.025, 0.07), level: between(0.012, 0.028), wave: "sine", from, to: from * between(1.4, 2.2) });
  };

  const stir = (time: number): void => {
    for (const band of babble) {
      glide(band.filter.frequency, band.frequency * between(0.7, 1.35), between(0.03, 0.1), time);
      glide(band.gain.gain, band.level * between(0.45, 1.3), between(0.04, 0.12), time);
    }
  };

  const blow = (time: number, strength: number): void => {
    const gustLevel = between(0.35, 1) * (0.6 + 0.4 * strength);
    const seconds = between(0.6, 1.6);
    glide(gust.gain, gustLevel, seconds, time);
    glide(windBody.frequency, 340 + 600 * gustLevel, seconds * 1.3, time);
    glide(leaves.gain, 0.01 + 0.07 * gustLevel * gustLevel, seconds * 0.6, time);
  };

  const state: SoundState = { night: 0, nearWater: 0, wind: 0, speed: 0, surface: "grass" };
  let levelTimer = 0;

  const applyLevels = (): void => {
    const day = 1 - smoothstep(0.15, 0.5, state.night);
    const dark = smoothstep(0.35, 0.8, state.night);
    const move = clamp01(state.speed / SPRINT_SPEED);
    glide(river.gain, 0.05 + 0.95 * state.nearWater ** 1.4, 0.4);
    glide(wind.gain, 0.05 + 0.6 * state.wind, 0.8);
    glide(birds.gain, day, 1.5);
    glide(night.gain, dark, 2);
    glide(pad.gain, PAD_LEVEL * (0.7 + 0.5 * state.night), 3);
    glide(swish.gain, move * (state.surface === "grass" ? 0.07 : state.surface === "water" ? 0.12 : 0), 0.15);
    glide(swishBand.frequency, state.surface === "water" ? 900 : 3000, 0.1);
  };

  const clocks = { birds: { next: 0 }, owl: { next: 0 }, bubbles: { next: 0 }, stir: { next: 0 }, gust: { next: 0 } };
  /** Queues the events of one random process up to the lookahead; a stalled clock restarts from now instead of bursting. */
  const run = (clock: Clock, active: boolean, interval: () => number, play: (time: number) => void): void => {
    const start = now();
    if (!active) {
      clock.next = 0;
      return;
    }
    if (clock.next < start) clock.next = start + interval() * random();
    while (clock.next < start + LOOKAHEAD) {
      play(clock.next);
      clock.next += interval();
    }
  };

  const update = (dt: number, next: SoundState): void => {
    state.night = clamp01(next.night);
    state.nearWater = clamp01(next.nearWater);
    state.wind = clamp01(next.wind);
    state.speed = Number.isFinite(next.speed) ? Math.max(0, next.speed) : 0;
    state.surface = next.surface;
    levelTimer -= dt;
    if (levelTimer <= 0) {
      levelTimer = LEVEL_INTERVAL;
      applyLevels();
    }
    const day = 1 - smoothstep(0.15, 0.5, state.night);
    const dark = smoothstep(0.35, 0.8, state.night);
    run(clocks.stir, true, () => between(0.08, 0.2), stir);
    run(clocks.gust, true, () => between(1.2, 3.5), (time) => blow(time, state.wind));
    run(clocks.bubbles, state.nearWater > 0.25, () => wait(1 / (18 * state.nearWater ** 2)), bubble);
    run(clocks.birds, day > 0.05, () => wait(3.5 / day), sing);
    run(clocks.owl, dark > 0.5, () => wait(28), hoot);
    for (const cricket of crickets) {
      run(cricket.clock, dark > 0.05, () => cricket.interval * between(0.92, 1.08) + (random() < 0.04 ? between(2, 6) : 0), (time) => chirp(cricket, time));
    }
    const frogLevel = 0.08 * (0.3 + 0.7 * state.nearWater);
    for (const frog of frogs) {
      run(frog.clock, dark > 0.05, () => wait(4 + 8 * (1 - state.nearWater)), (time) => croak(frog, time, frogLevel));
    }
  };

  const knock = (time: number, strength: number): void => {
    const body = between(0.94, 1.06);
    const modes = [
      { frequency: 185, decay: 0.14, level: 0.26 },
      { frequency: 430, decay: 0.09, level: 0.13 },
      { frequency: 930, decay: 0.06, level: 0.07 },
      { frequency: 1680, decay: 0.035, level: 0.045 }
    ];
    for (const mode of modes) {
      const frequency = mode.frequency * body;
      tone(steps, { time, attack: 0.002, decay: mode.decay, level: mode.level * strength, wave: "sine", from: frequency * 1.04, to: frequency });
    }
    burst(steps, { time, attack: 0.001, decay: 0.01, level: 0.25 * strength, type: "lowpass", frequency: 3200, q: 0.7 });
  };

  const footstep = (surface: Surface, intensity: number): void => {
    const effort = clamp01(intensity);
    const strength = (0.35 + 0.65 * effort) * between(0.85, 1.12);
    const bright = 1 + 0.25 * effort;
    const time = now() + 0.005;
    if (surface === "wood") {
      knock(time, strength);
      knock(time + between(0.035, 0.05), strength * 0.55);
      return;
    }
    if (surface === "water") {
      burst(steps, { time, attack: 0.012, decay: 0.26, level: 0.45 * strength, type: "bandpass", frequency: 1500 * bright, q: 0.9, sweep: 650 });
      burst(steps, { time, attack: 0.004, decay: 0.12, level: 0.12 * strength, type: "highpass", frequency: 4000, q: 0.7 });
      tone(steps, { time, attack: 0.004, decay: 0.1, level: 0.14 * strength, wave: "sine", from: 260, to: 120 });
      for (let drop = 3 + Math.floor(random() * 3); drop > 0; drop -= 1) {
        const from = between(800, 2200);
        tone(steps, { time: time + between(0.05, 0.3), attack: 0.002, decay: between(0.025, 0.06), level: between(0.03, 0.06) * strength, wave: "sine", from, to: from * 1.7 });
      }
      return;
    }
    if (surface === "dirt") {
      for (let grain = 5 + Math.floor(random() * 4); grain > 0; grain -= 1) {
        burst(steps, { time: time + random() * 0.09, attack: 0.001, decay: between(0.008, 0.022), level: between(0.2, 0.4) * strength, type: "bandpass", frequency: between(1600, 4800) * bright, q: 2.2 });
      }
      burst(steps, { time, attack: 0.006, decay: 0.08, level: 0.22 * strength, type: "lowpass", frequency: 900, q: 0.7 });
      tone(steps, { time, attack: 0.003, decay: 0.08, level: 0.16 * strength, wave: "sine", from: 120, to: 65 });
      return;
    }
    burst(steps, { time, attack: 0.012, decay: 0.1, level: 0.3 * strength, type: "bandpass", frequency: 2400 * bright * between(0.85, 1.15), q: 0.8 });
    burst(steps, { time: time + between(0.04, 0.06), attack: 0.008, decay: 0.07, level: 0.2 * strength, type: "bandpass", frequency: 3600 * bright * between(0.85, 1.15), q: 1.1 });
    tone(steps, { time, attack: 0.004, decay: 0.07, level: 0.12 * strength, wave: "sine", from: 95, to: 55 });
  };

  const stop = (): void => {
    for (const source of continuous) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    master.disconnect();
  };

  return { update, footstep, setVolume: (value) => glide(master.gain, value, 0.06), stop };
};

const createContext = (): AudioContext | undefined => {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Context = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Context) return undefined;
  try {
    return new Context({ latencyHint: "balanced" });
  } catch {
    return undefined;
  }
};

export const createSoundscape = (options: SoundscapeOptions = {}): Soundscape => {
  const random = options.random ?? Math.random;
  let owned: AudioContext | undefined;
  let engine: Engine | undefined;
  let muted = false;
  let disposed = false;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;

  const running = (): boolean => !owned || owned.state === "running";

  const resume = async (): Promise<void> => {
    if (disposed) return;
    try {
      if (!options.context && !owned) owned = createContext();
      const context = options.context ?? owned;
      if (!context) return;
      engine ??= createEngine(context, random, muted ? 0 : MASTER_VOLUME);
      if (owned && !muted && owned.state !== "running") await owned.resume();
    } catch {
      // a refused or broken WebAudio just stays silent
    }
  };

  const setMuted = (value: boolean): void => {
    muted = value;
    if (disposed) return;
    engine?.setVolume(muted ? 0 : MASTER_VOLUME);
    if (!owned) return;
    clearTimeout(suspendTimer);
    const context = owned;
    if (muted) {
      suspendTimer = setTimeout(() => {
        if (muted) context.suspend().catch(() => undefined);
      }, 400);
    } else {
      context.resume().catch(() => undefined);
    }
  };

  const update = (dt: number, state: SoundState): void => {
    if (!engine || muted || disposed || !running()) return;
    engine.update(dt, state);
  };

  const footstep = (surface: Surface, intensity: number): void => {
    if (!engine || muted || disposed || !running()) return;
    engine.footstep(surface, intensity);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearTimeout(suspendTimer);
    engine?.stop();
    engine = undefined;
    owned?.close().catch(() => undefined);
    owned = undefined;
  };

  return { resume, setMuted, isMuted: () => muted, update, footstep, dispose };
};
