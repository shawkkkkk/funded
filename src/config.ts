export type LaunchSigner = 'creator' | 'funded_operator';
export type CustodyMode = 'funded_receiver_unapproved' | 'qualified_custodian' | 'funded_launches';
export type PricingMode = 'zero_spread' | 'separate_incentive';
export type DeploymentMode = 'local' | 'public_readonly';

export type FundedConfig = {
  product: 'Funded';
  launchEnabled: false;
  peerOrdersEnabled: false;
  launchSigner: LaunchSigner;
  custody: CustodyMode;
  pricing: PricingMode;
  deploymentMode: DeploymentMode;
  publicOrigin?: string;
  bindAddress: '127.0.0.1' | '0.0.0.0';
  databaseUrl?: string;
  feeReceiver?: string;
};

const signers = new Set<LaunchSigner>(['creator', 'funded_operator']);
const custodies = new Set<CustodyMode>(['funded_receiver_unapproved', 'qualified_custodian', 'funded_launches']);
const prices = new Set<PricingMode>(['zero_spread', 'separate_incentive']);
const deploymentModes = new Set<DeploymentMode>(['local', 'public_readonly']);

function publicOrigin(value: string | undefined) {
  if (!value) return undefined;
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw Error('FUNDED_PUBLIC_ORIGIN must be an HTTPS origin without a path, query, credentials, or fragment');
  }
  return parsed.origin;
}

/** Recommended defaults. Launch and Peer execution stay off in this build even if the environment asks for them. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): FundedConfig {
  const launchSigner = (env.FUNDED_LAUNCH_SIGNER ?? 'creator') as LaunchSigner;
  const custody = (env.FUNDED_CUSTODY ?? 'funded_receiver_unapproved') as CustodyMode;
  const pricing = (env.FUNDED_PRICING ?? 'zero_spread') as PricingMode;
  const deploymentMode = (env.FUNDED_DEPLOYMENT_MODE ?? 'local') as DeploymentMode;
  if (!signers.has(launchSigner)) throw Error('Invalid launch signer');
  if (!custodies.has(custody)) throw Error('Invalid custody mode');
  if (!prices.has(pricing)) throw Error('Invalid pricing mode');
  if (!deploymentModes.has(deploymentMode)) throw Error('Invalid deployment mode');
  const databaseUrl = env.FUNDED_DATABASE_URL?.trim() || undefined;
  if (databaseUrl && !/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw Error('FUNDED_DATABASE_URL must be a postgres URL');
  const origin = publicOrigin(env.FUNDED_PUBLIC_ORIGIN?.trim());
  if (deploymentMode === 'public_readonly' && (!origin || !databaseUrl)) {
    throw Error('Public read-only mode requires FUNDED_PUBLIC_ORIGIN and FUNDED_DATABASE_URL');
  }
  return {
    product: 'Funded',
    launchEnabled: false,
    peerOrdersEnabled: false,
    launchSigner, custody, pricing, deploymentMode, publicOrigin: origin,
    bindAddress: deploymentMode === 'public_readonly' ? '0.0.0.0' : '127.0.0.1',
    databaseUrl,
    feeReceiver: env.FUNDED_FEE_RECEIVER?.trim() || undefined
  };
}
