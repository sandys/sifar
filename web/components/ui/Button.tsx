import { forwardRef } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  /**
   * Touch target height. `md` (48px) is the default because this app is used
   * one-handed on a phone while holding a cabled hardware wallet. `sm` (44px)
   * is the floor, never go below it. `lg` (56px) is for the primary action on
   * a screen or sheet.
   */
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const SIZES = {
  sm: 'min-h-[44px] px-3 text-sm',
  md: 'min-h-[48px] px-4 text-base',
  lg: 'min-h-[56px] px-5 text-base'
};

const VARIANTS = {
  primary: 'bg-ember text-white hover:bg-ember/90 active:bg-ember/80',
  ghost:
    'border border-amber-200 bg-white/60 text-steel hover:bg-white active:bg-amber-50',
  danger: 'bg-black text-white hover:bg-black/90 active:bg-black/80'
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'primary', size = 'md', fullWidth, ...props },
    ref
  ) => {
    const base =
      'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ember/40 disabled:opacity-50 disabled:pointer-events-none';

    // Plain join: the variant/size maps are closed sets with no overlapping
    // utilities, so there is nothing for tailwind-merge to resolve. A caller's
    // className still wins on source order.
    const classes = [
      base,
      SIZES[size],
      VARIANTS[variant],
      fullWidth ? 'w-full' : '',
      className
    ]
      .filter(Boolean)
      .join(' ');

    return <button ref={ref} className={classes} {...props} />;
  }
);

Button.displayName = 'Button';
