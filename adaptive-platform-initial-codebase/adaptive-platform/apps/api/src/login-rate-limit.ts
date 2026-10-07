export const LOGIN_LIMIT = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_TRACKED_LOGIN_KEYS = 4096;

interface AttemptWindow {
  count: number;
  startedAt: number;
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptWindow>();

  constructor(
    private readonly limit = LOGIN_LIMIT,
    private readonly windowMs = LOGIN_WINDOW_MS,
    private readonly maxTrackedKeys = MAX_TRACKED_LOGIN_KEYS,
  ) {}

  get trackedKeyCount(): number {
    return this.attempts.size;
  }

  allow(key: string, now = Date.now()): boolean {
    const current = this.attempts.get(key);
    if (current) {
      if (now - current.startedAt < this.windowMs) {
        if (current.count >= this.limit) return false;
        current.count++;
        return true;
      }
      this.attempts.delete(key);
    }

    if (this.maxTrackedKeys <= 0) return false;
    if (this.attempts.size >= this.maxTrackedKeys) {
      const oldestKey = this.attempts.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.attempts.delete(oldestKey);
    }
    this.attempts.set(key, { count: 1, startedAt: now });
    return true;
  }
}
