export type LaunchSigner = 'creator' | 'funded_operator';
export type CustodyMode = 'funded_receiver_unapproved' | 'qualified_custodian' | 'funded_launches';
export type PricingMode = 'zero_spread' | 'separate_incentive';

export type FundedConfig = {
  product: 'Funded';
  launchEnabled: false;
  peerOrdersEnabled: false;
  launchSigner: LaunchSigner;
  custody: CustodyMode;
  pricing: PricingMode;
  databaseUrl?: string;
  feeReceiver?: string;
};

const signers = new Set<LaunchSigner>(['creator', 'funded_operator']);
const custodies = new Set<CustodyMode>(['funded_receiver_unapproved', 'qualified_custodian', 'funded_launches']);
const prices = new Set<PricingMode>(['zero_spread', 'separate_incentive']);

/** Recommended defaults. Launch and Peer execution stay off in this build even if the environment asks for them. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): FundedConfig {
  const launchSigner = (env.FUNDED_LAUNCH_SIGNER ?? 'creator') as LaunchSigner;
  const custody = (env.FUNDED_CUSTODY ?? 'funded_receiver_unapproved') as CustodyMode;
  const pricing = (env.FUNDED_PRICING ?? 'zero_spread') as PricingMode;
  if (!signers.has(launchSigner)) throw Error('Invalid launch signer');
  if (!custodies.has(custody)) throw Error('Invalid custody mode');
  if (!prices.has(pricing)) throw Error('Invalid pricing mode');
  const databaseUrl = env.FUNDED_DATABASE_URL?.trim() || undefined;
  if (databaseUrl && !/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw Error('FUNDED_DATABASE_URL must be a postgres URL');
  return {
    product: 'Funded',
    launchEnabled: false,
    peerOrdersEnabled: false,
    launchSigner, custody, pricing, databaseUrl,
    feeReceiver: env.FUNDED_FEE_RECEIVER?.trim() || undefined
  };
}
