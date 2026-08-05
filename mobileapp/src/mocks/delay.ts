/**
 * Artificial latency for the UI phase.
 *
 * Without it every screen resolves instantly and loading states are never
 * seen — which is exactly how skeletons rot before a real API arrives.
 * Deterministic per key so demos and screenshots stay stable.
 */
export function delay(key: string, min = 300, max = 900): Promise<void> {
  const ms = min + (hash(key) % Math.max(1, max - min));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}
