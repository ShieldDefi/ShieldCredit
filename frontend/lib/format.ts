export function truncateAddress(address?: string | null) {
  if (!address) {
    return "Unavailable";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function shortenValue(value: string, maxLength = 52) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

export function formatUsdMicro(value?: bigint | null) {
  if (value === null || typeof value === "undefined") {
    return "--";
  }

  return (Number(value) / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCompactNumber(value?: number | null) {
  if (value === null || typeof value === "undefined") {
    return "--";
  }

  return value.toLocaleString("en-US");
}

export function formatDate(value?: bigint | null) {
  if (value === null || typeof value === "undefined" || value === 0n) {
    return "--";
  }

  return new Date(Number(value) * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function parseUsdToMicro(value: string) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Enter a valid amount greater than zero.");
  }

  return BigInt(Math.round(numeric * 1_000_000));
}
