import { IntegrationBlocked } from './policy.ts';

export type ScreenSubject = { kind: 'handle' | 'mint' | 'address'; value: string };
export type ScreenResult = { decision: 'clear' | 'review' | 'blocked'; provider: 'fixture'; live: false; reason: string | null };

const kinds = new Set(['handle', 'mint', 'address']);

/** Local denial list only. A clear result is not a sanctions clearance and is not a live vendor response. */
export class FixtureScreener {
  private denied: Set<string>;
  constructor(denied: Iterable<string> = []) {
    this.denied = new Set([...denied].map(normalize).filter(Boolean));
  }
  async screen(subject: ScreenSubject): Promise<ScreenResult> {
    if (!kinds.has(subject.kind)) return { decision: 'review', provider: 'fixture', live: false, reason: 'Unknown subject' };
    const value = normalize(subject.value);
    if (!value || value.length > 80) return { decision: 'review', provider: 'fixture', live: false, reason: 'Subject needs review' };
    if (this.denied.has(value)) return { decision: 'blocked', provider: 'fixture', live: false, reason: 'Fixture denial list' };
    return { decision: 'clear', provider: 'fixture', live: false, reason: null };
  }
}

export function liveScreener(): never {
  throw new IntegrationBlocked('No sanctions vendor is connected. A fixture result is not clearance to receive funds or to pay.');
}

export function screenerFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return new FixtureScreener((env.FUNDED_SCREEN_DENY ?? '').split(','));
}

function normalize(value: string) {
  return value.trim().replace(/^@/, '').toLowerCase();
}
