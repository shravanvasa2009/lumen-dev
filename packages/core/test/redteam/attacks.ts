// Red-team signal generators (§16). Every attack is deterministic so a failure reproduces from its
// parameters alone.

export type Channels = (tS: number) => { r: number; g: number; b: number };

// Park–Miller (16807, mod 2³¹ − 1) with Box–Muller: exact in doubles, so a seed names a draw.
export function seededNormal(seed: number): () => number {
  let state = seed;
  const nextUniform = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(nextUniform())) * Math.cos(2 * Math.PI * nextUniform());
}

// Red falls as blood volume rises: a 1% pulse (0.006 of a 0.6 level) is a typical fingertip PPG.
export function sinePulse(bpm: number, amplitude = 0.006, level = 0.6): Channels {
  return (tS) => ({ r: level - amplitude * Math.sin((2 * Math.PI * bpm * tS) / 60), g: 0.1, b: 0.05 });
}

export function flatRed(level: number): Channels {
  return () => ({ r: level, g: 0.1, b: 0.05 });
}

export function withRed(channels: Channels, redOffset: (tS: number) => number): Channels {
  return (tS) => {
    const frame = channels(tS);
    return { ...frame, r: frame.r + redOffset(tS) };
  };
}

const gaussian = (x: number, centre: number, width: number) => Math.exp(-0.5 * ((x - centre) / width) ** 2);

// One beat at each time in beatTimesS: systolic wave 0.12 s after the foot and a dicrotic wave 0.40 s
// after it (absolute times, as in a real pulse, whose systole barely changes with rate), each 70 ms wide.
export function beatTrain(beatTimesS: number[], dicroticRatio = 0.3, amplitude = 0.006): Channels {
  return (tS) => {
    let volume = 0;
    for (const beatS of beatTimesS)
      volume += gaussian(tS - beatS, 0.12, 0.07) + dicroticRatio * gaussian(tS - beatS, 0.4, 0.07);
    return { r: 0.6 - amplitude * volume, g: 0.1, b: 0.05 };
  };
}

// Beat times from −2 s (so the window opens mid-rhythm) to beyond `untilS`, cycling through intervalsS.
export function beatTimes(intervalsS: number[], untilS: number): number[] {
  const times: number[] = [];
  for (let tS = -2, k = 0; tS < untilS + 2; tS += intervalsS[k++ % intervalsS.length]!) times.push(tS);
  return times;
}

// The spec allows a function to refuse bad input with a RangeError or to return null; anything else that
// is not finite would reach a model or the screen.
export function outcomeOf(
  compute: () => ArrayLike<number> | null,
): 'null' | 'RangeError' | 'finite' | 'non-finite' {
  try {
    const output = compute();
    if (output === null) return 'null';
    return Array.from(output).every(Number.isFinite) ? 'finite' : 'non-finite';
  } catch (error) {
    if (error instanceof RangeError) return 'RangeError';
    throw error;
  }
}
