# ShieldCredit Protocol

> *Confidential RWA-Backed Lending · Powered by Zama fhEVM*

Traditional DeFi lending exposes all financial details on-chain — collateral values, loan amounts, credit positions — making institutional participation impractical due to competitive intelligence leakage and regulatory exposure.

ShieldCredit solves this using Zama's Fully Homomorphic Encryption (FHE) coprocessor. Real-world asset face values, loan amounts, outstanding balances, and credit scores are encrypted using `euint64`/`euint32` and never appear in plaintext on-chain. Computations like LTV checks, interest accrual, and liquidation thresholds execute directly on ciphertext. Only authorized parties — the borrower and the regulator — can decrypt specific values, with every decryption requiring an EIP-712 signature and being fully traceable on-chain.

---

## Architecture

```
[Institution / Borrower]
        |
        v
[RWARegistry] ─── register encrypted asset ──► [fhEVM: euint64 faceValue]
        |
        | lockAsset()
        v
[PrivateLending] ◄──── isEligible() ────► [CreditScore]
        |                                       |
        | mint(disbursement)                    | updateScore()
        v                                       v
[ConfidentialStablecoin]             [Scoring Oracle]
   euint64 balances

        └─────── all encrypted ops ──────────┘
                         |
                [Zama fhEVM Coprocessors]
                [Gateway: requestDecrypt()]
```

---

## Privacy Model

| Actor      | Sees                                        | Cannot See                              | Decrypt Right                        |
|------------|---------------------------------------------|-----------------------------------------|--------------------------------------|
| Borrower   | Own balance, own loan amounts               | Other borrowers' balances or loans      | Own balance + own loan fields (EIP-712) |
| Public     | Loan status, interest rate, asset metadata  | Any encrypted amounts or scores         | None                                 |
| Regulator  | All loan fields for all borrowers           | Private keys, oracle internals          | All loan fields via re-encryption    |

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/ShieldDefi/ShieldRemit.git
cd ShieldRemit
npm install

# Configure environment
cp .env.example .env
# Fill in PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY

# Compile contracts
npm run compile

# Run tests (requires fhEVM mock or local node)
npm test

# Deploy to Sepolia
npm run deploy:sepolia

# Run end-to-end demo on Sepolia
npm run demo

# Start frontend
npm run frontend
```

---

## Loan Lifecycle

1. **Asset Registration** — Institution calls `RWARegistry.registerAsset()` with an encrypted face value. The `euint64` handle is stored on-chain; plaintext never leaves the client.
2. **Loan Request** — Borrower calls `PrivateLending.requestLoan()` with an encrypted loan amount. The contract computes 70% LTV and credit eligibility entirely on ciphertext using `TFHE.mul`, `TFHE.div`, `TFHE.le`, `TFHE.and`, `TFHE.select`.
3. **Disbursement** — If approved, `TFHE.select(approved, loanAmount, 0)` determines the disbursement. Stablecoin is minted to the borrower with an encrypted balance.
4. **Interest Accrual** — Anyone can call `accrueInterest()`. Interest is computed as `principal × rate × elapsed / (SECONDS_PER_YEAR × 10000)` on ciphertext.
5. **Repayment** — Borrower encrypts a repayment amount. `TFHE.min(repay, outstanding)` ensures they cannot overpay. A Gateway decrypt call on `outstanding == 0` triggers a callback to mark the loan REPAID and unlock the asset.
6. **Liquidation Check** — `checkAndLiquidate()` computes `TFHE.gt(outstanding, liquidationThreshold)` and requests a Gateway decrypt. If true, the asset is transferred to the protocol and the borrower's credit score is penalized.

---

## Compliance Model

The regulator ACL is established at loan creation: `TFHE.allow(field, regulator)` is called for every encrypted field (`principal`, `outstandingBalance`, `collateralValue`, `liquidationThreshold`). The regulator address is set by the contract owner via `setRegulator()`, and any change re-allows all active loan fields for the new address.

To actually read an encrypted value, the regulator must:
1. Hold the designated regulator address
2. Call `getEncryptedLoanFields()` to obtain the `euint64` handles
3. Generate an EIP-712 re-encryption request signed with their private key
4. Submit to the Zama Gateway, which returns a re-encrypted ciphertext decryptable only by the regulator's key

Every re-encryption request produces an on-chain event, making regulator access fully auditable.

---

## fhEVM Primitives Used

- **Types**: `euint64`, `euint32`, `ebool`
- **Arithmetic**: `TFHE.add`, `TFHE.sub`, `TFHE.mul`, `TFHE.div`
- **Comparisons**: `TFHE.le`, `TFHE.ge`, `TFHE.lt`, `TFHE.gt`, `TFHE.eq`
- **Logic**: `TFHE.and`, `TFHE.select`
- **Clamping**: `TFHE.min`, `TFHE.max`
- **Access Control**: `TFHE.allow`, `TFHE.allowThis`
- **Conversion**: `TFHE.asEuint64`, `TFHE.asEuint32`
- **Gateway**: `Gateway.requestDecrypt` with typed callbacks

---

## Security Considerations

- **No plaintext in events**: All `Transfer`, `LoanCreated`, `LoanRepaid`, and `LoanLiquidated` events carry no amount data — only addresses and IDs.
- **ACL on all transfers**: Every encrypted handle write is followed by `TFHE.allow()` for every authorized party; handles without explicit permission cannot be re-encrypted.
- **Gateway callback authentication**: Callbacks (`callbackRepay`, `callbackLiquidate`) verify `msg.sender == Gateway.getGateway()` to prevent spoofing.
- **Reentrancy guards**: All state-changing public functions use OpenZeppelin's `ReentrancyGuard`.
- **Oracle trust assumption**: The scoring oracle has unilateral ability to update credit scores. In production, this should be a multi-sig or a verifiable oracle network.

---

## License

MIT 
