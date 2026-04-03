function getRawMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const maybeError = error as {
      shortMessage?: string;
      message?: string;
      reason?: string;
      info?: { error?: { message?: string } };
    };

    return (
      maybeError.shortMessage ||
      maybeError.reason ||
      maybeError.info?.error?.message ||
      maybeError.message ||
      "Unexpected error"
    );
  }

  return "Unexpected error";
}

export function normalizeError(error: unknown) {
  const message = getRawMessage(error);

  if (
    message.includes("UNCONFIGURED_NAME") ||
    message.includes("contract target") ||
    message.includes("ENS name used for a contract target")
  ) {
    return "ShieldCredit could not load the live contract addresses. Refresh the page and reconnect to Sepolia.";
  }

  if (message.includes("Connect a wallet first") || message.includes("No injected wallet found")) {
    return "Connect a Sepolia browser wallet to continue.";
  }

  if (message.includes("user rejected") || message.includes("ACTION_REJECTED")) {
    return "The request was cancelled in your wallet.";
  }

  if (message.includes("Please switch your wallet")) {
    return message;
  }

  if (message.includes("issuer not whitelisted")) {
    return "This wallet is not whitelisted to register collateral.";
  }

  if (message.includes("not asset owner")) {
    return "Only the current asset owner can borrow against this collateral.";
  }

  if (message.includes("asset already locked")) {
    return "This asset is already locked against an active loan.";
  }

  if (message.includes("not borrower")) {
    return "Only the borrower can manage this position.";
  }

  if (message.includes("not authorized")) {
    return "This wallet is not authorized to view or manage that confidential data.";
  }

  if (message.includes("loan not active")) {
    return "This loan is no longer active.";
  }

  if (message.includes("Stablecoin faucet is not configured")) {
    return "The deployed faucet is unavailable in this build.";
  }

  return message.replace(/^Error:\s*/, "");
}
