import type { CSSProperties, ReactNode } from 'react';

const KEYFRAMES = `@keyframes rawdash-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}`;

const BASE_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  height: '1rem',
  borderRadius: '0.375rem',
  backgroundColor: '#e5e7eb',
  animation: 'rawdash-skeleton-pulse 1.6s ease-in-out infinite',
};

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Skeleton({
  width,
  height,
  radius,
  className,
  style,
  children,
}: SkeletonProps) {
  const merged: CSSProperties = {
    ...BASE_STYLE,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(radius !== undefined ? { borderRadius: radius } : {}),
    ...style,
  };
  const styleProps = { precedence: 'rawdash-skeleton' } as Record<
    string,
    string
  >;
  return (
    <>
      <style {...styleProps}>{KEYFRAMES}</style>
      <span aria-hidden="true" className={className} style={merged}>
        {children}
      </span>
    </>
  );
}
