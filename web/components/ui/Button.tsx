import { forwardRef } from 'react';
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-ember/40 disabled:opacity-50';
    const styles = {
      primary: 'bg-ember text-white hover:bg-ember/90',
      ghost: 'border border-amber-200 bg-white/60 text-steel hover:bg-white',
      danger: 'bg-black text-white hover:bg-black/90'
    };

    const classes = [base, styles[variant], className].filter(Boolean).join(' ');

    return <button ref={ref} className={classes} {...props} />;
  }
);

Button.displayName = 'Button';
