"use client";

import { useTokenList } from "@/hooks/useTokenList";
import styles from "./TokenIcon.module.css";

interface TokenIconProps {
  symbol: string;
  size?: number;
  showSymbol?: boolean;
  className?: string;
}

export function TokenIcon({
  symbol,
  size = 16,
  showSymbol = false,
  className,
}: TokenIconProps) {
  const { getToken } = useTokenList();
  const token = getToken(symbol);
  const label = token?.symbol ?? symbol;

  const icon = token?.logoURI ? (
    <img
      src={token.logoURI}
      alt={label}
      width={size}
      height={size}
      className={`${styles.icon} ${className ?? ""}`}
    />
  ) : (
    <span
      className={className}
      style={{ width: size, height: size, fontSize: size * 0.75, lineHeight: `${size}px` }}
      aria-hidden
    >
      {label.slice(0, 1)}
    </span>
  );

  if (!showSymbol) return icon;

  return (
    <span className={styles.label}>
      {icon}
      <span className={styles.symbol}>{label}</span>
    </span>
  );
}
