import Image from "next/image";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export default function BrandMark({ size = 40, className = "" }: BrandMarkProps) {
  return (
    <Image
      src="/shieldcredit-favicon.svg"
      alt="ShieldCredit logo"
      width={size}
      height={size}
      className={className}
    />
  );
}
