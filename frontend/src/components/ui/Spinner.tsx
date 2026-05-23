/**
 * Spinner Component
 * Loading indicator unificado pra todo o app.
 *
 * Uso:
 *   <Spinner />                    // 16px default
 *   <Spinner size="sm" />          // 12px
 *   <Spinner size="lg" />          // 24px
 *   <Spinner label="Carregando" /> // com texto ao lado
 *   <Spinner inline />             // inline-block, nao quebra linha
 *   <Spinner.Block label="..." />  // bloco centralizado pra estados de loading de pagina
 */
'use client';

import React from 'react';

const SIZE_PX: Record<NonNullable<SpinnerProps['size']>, number> = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 32,
  xl: 48,
};

const STROKE_PX: Record<NonNullable<SpinnerProps['size']>, number> = {
  xs: 2,
  sm: 2,
  md: 2.5,
  lg: 3,
  xl: 4,
};

export interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  label?: string;
  inline?: boolean;
  variant?: 'primary' | 'neutral' | 'inverse' | 'danger' | 'success' | 'warning';
}

const VARIANT_CLASS: Record<NonNullable<SpinnerProps['variant']>, string> = {
  primary: 'text-blue-600',
  neutral: 'text-gray-400',
  inverse: 'text-white',
  danger: 'text-red-600',
  success: 'text-green-600',
  warning: 'text-amber-600',
};

const SpinnerSVG: React.FC<{ size: number; stroke: number; className?: string }> = ({
  size,
  stroke,
  className = '',
}) => (
  <svg
    className={`animate-spin ${className}`}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth={stroke}
    />
    <path
      d="M22 12a10 10 0 0 1-10 10"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
    />
  </svg>
);

interface SpinnerComponent extends React.FC<SpinnerProps> {
  Block: React.FC<SpinnerProps>;
}

export const Spinner: SpinnerComponent = ({
  size = 'sm',
  className = '',
  label,
  inline = false,
  variant = 'primary',
}) => {
  const colorClass = VARIANT_CLASS[variant];
  const wrapper = inline
    ? `inline-flex items-center gap-2 ${colorClass}`
    : `flex items-center gap-2 ${colorClass}`;
  return (
    <span className={`${wrapper} ${className}`} role="status" aria-live="polite">
      <SpinnerSVG size={SIZE_PX[size]} stroke={STROKE_PX[size]} />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
};

/** Bloco centralizado, util pra estados de loading de pagina/secao. */
Spinner.Block = ({ size = 'lg', label, variant = 'primary', className = '' }) => (
  <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
    <Spinner size={size} variant={variant} />
    {label && <p className="text-sm text-gray-500">{label}</p>}
  </div>
);

export default Spinner;
