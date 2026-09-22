const ONE_HOUR_MS = 3_600_000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (ms >= ONE_HOUR_MS) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}
