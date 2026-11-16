import type { FundedConfig } from './config.ts';

export function hostAllowed(config: FundedConfig, host: string | undefined) {
  if (!host) return false;
  if (config.deploymentMode === 'local') return /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(host);
  return host === new URL(config.publicOrigin!).host;
}

export function writeOriginAllowed(config: FundedConfig, host: string | undefined, origin: string | undefined) {
  if (!hostAllowed(config, host) || !origin) return false;
  return origin === (config.deploymentMode === 'local' ? 'http://' + host : config.publicOrigin);
}
