import type { ContractClient } from '@emdash/wire/rpc';
import { domainClient } from '@core/primitives/wire/browser/connection';
import { cockpitContract, cockpitDomain } from '../contract';

export type CockpitRpcClient = ContractClient<typeof cockpitContract>;

export function getCockpitClient(): Promise<CockpitRpcClient> {
  return domainClient<CockpitRpcClient>(cockpitDomain, cockpitContract);
}
