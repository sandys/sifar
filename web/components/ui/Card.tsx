export function Card({
  title,
  children,
  className = ''
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-amber-200/40 bg-white/85 p-5 shadow-[0_18px_45px_-35px_rgba(0,0,0,0.5)] ${className}`}
    >
      {title ? <h3 className="font-jomhuria text-2xl tracking-wide">{title}</h3> : null}
      <div className={title ? 'mt-3' : ''}>{children}</div>
    </section>
  );
}
