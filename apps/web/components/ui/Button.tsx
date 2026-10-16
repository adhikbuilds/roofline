import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-purple text-white shadow-[0_1px_2px_rgb(91_33_182/0.4),inset_0_1px_0_rgb(255_255_255/0.18)] hover:bg-purple-600 active:bg-purple-600',
  secondary: 'border border-line bg-surface text-ink hover:border-ink-3 hover:bg-canvas',
  ghost: 'text-ink-2 hover:bg-purple-50 hover:text-purple-600',
  dark: 'bg-ink text-white hover:bg-[#232b52]',
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3.5 text-[14px]',
  md: 'h-11 gap-2 px-5 text-[15px]',
  lg: 'h-[52px] gap-2 px-6 text-[16px]',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(
    'type-label inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[12px]',
    'transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    extra,
  );
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode; iconRight?: ReactNode; className?: string };

export function Button({
  variant,
  size,
  icon,
  iconRight,
  className,
  children,
  type = 'button',
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
      {iconRight}
    </button>
  );
}

/** Same look, rendered as a link. */
export function ButtonLink({
  href,
  variant,
  size,
  icon,
  iconRight,
  className,
  children,
  ...rest
}: Common & { href: string; children: ReactNode; 'aria-label'?: string; prefetch?: boolean }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}
