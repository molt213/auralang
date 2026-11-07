/** RMS below this threshold is treated as silence (paused video / no speech). */
export const SILENCE_RMS_THRESHOLD = 0.008

export function rmsOf(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

export function isSilentRms(rms: number): boolean {
  return rms < SILENCE_RMS_THRESHOLD
}

export function isSilent(samples: Float32Array): boolean {
  return isSilentRms(rmsOf(samples))
}
