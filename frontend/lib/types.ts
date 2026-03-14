export type AssetType = 'TREASURY_BOND' | 'INVOICE' | 'REAL_ESTATE' | 'EQUITY';

export interface Asset {
  id: bigint;
  assetType: AssetType;
  metadataURI: string;
  locked: boolean;
  lockedBy: string;
  registeredAt: bigint;
  owner: string;
}

export interface Loan {
  id: bigint;
  assetId: bigint;
  borrower: string;
  status: 'NONE' | 'ACTIVE' | 'REPAID' | 'LIQUIDATED';
  interestRatePerYear: number;
  createdAt: bigint;
  lastAccrualAt: bigint;
}

export interface DecryptedLoan extends Loan {
  principal: bigint;
  outstandingBalance: bigint;
  collateralValue: bigint;
  liquidationThreshold: bigint;
}
