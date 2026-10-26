import robotsParser from 'robots-parser';
import { gunzipSync } from 'node:zlib';

export interface FetchResult {
  status: number;
  url: string;
  body: string;
}

type Robots = ReturnType<typeof robotsParser>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Høflig henting: maks én forespørsel per `minIntervalMs` per vert,
 * respekterer robots.txt og prøver på nytt ved midlertidige feil.
 */
export class PoliteFetcher {
  private nextSlot = new Map<string, number>();
  private robots = new Map<string, Promise<Robots | null>>();
  public requests = 0;

  constructor(
    public userAgent: string,
    private minIntervalMs = 1000,
    private timeoutMs = 30000,
  ) {}

  private async waitTurn(host: string) {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + this.minIntervalMs);
    if (slot > now) await sleep(slot - now);
  }

  async getRobots(origin: string): Promise<Robots | null> {
    if (!this.robots.has(origin)) {
      this.robots.set(
        origin,
        (async () => {
          const url = `${origin}/robots.txt`;
          try {
            const res = await this.rawFetch(url);
            if (res.status >= 400) return robotsParser(url, '');
            return robotsParser(url, res.body);
          } catch {
            return null;
          }
        })(),
      );
    }
    return this.robots.get(origin)!;
  }

  async isAllowed(url: string): Promise<boolean> {
    const robots = await this.getRobots(new URL(url).origin);
    if (!robots) return true;
    return robots.isAllowed(url, this.userAgent) !== false;
  }

  async sitemapsFromRobots(origin: string): Promise<string[]> {
    const robots = await this.getRobots(origin);
    return robots?.getSitemaps() ?? [];
  }

  private async rawFetch(url: string, method = 'GET', accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'): Promise<FetchResult> {
    const host = new URL(url).host;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.waitTurn(host);
      this.requests++;
      try {
        const res = await fetch(url, {
          method,
          redirect: 'follow',
          headers: {
            'User-Agent': this.userAgent,
            Accept: accept,
            'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8',
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status}`);
          await sleep(2000 * (attempt + 1));
          continue;
        }
        let body = '';
        if (method === 'GET') {
          const buf = Buffer.from(await res.arrayBuffer());
          body = url.endsWith('.gz') && buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
        }
        return { status: res.status, url: res.url || url, body };
      } catch (e) {
        lastErr = e;
        await sleep(2000 * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** Henter en side hvis robots.txt tillater det. Kaster `RobotsDisallowed` ellers. */
  async get(url: string): Promise<FetchResult> {
    if (!(await this.isAllowed(url))) throw new RobotsDisallowed(url);
    return this.rawFetch(url);
  }

  /** Som `get`, men ber om og tolker JSON. */
  async getJson<T = unknown>(url: string): Promise<{ status: number; data?: T }> {
    if (!(await this.isAllowed(url))) throw new RobotsDisallowed(url);
    const res = await this.rawFetch(url, 'GET', 'application/json');
    if (res.status >= 400) return { status: res.status };
    return { status: res.status, data: JSON.parse(res.body) as T };
  }
}

export class RobotsDisallowed extends Error {
  constructor(url: string) {
    super(`robots.txt tillater ikke ${url}`);
  }
}
