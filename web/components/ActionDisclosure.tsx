'use client';

import type { ActionDisclosure as ActionDisclosureContent } from '@/lib/actionDisclosure';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';

const BADGE_STYLES = {
  'not-signing': 'border-moss/30 bg-moss/10 text-moss',
  signing: 'border-ember/30 bg-ember/10 text-ember',
  'signing-and-sending': 'border-black bg-black text-white'
};

export function ActionDisclosurePanel({
  disclosure
}: {
  disclosure: ActionDisclosureContent;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] ${BADGE_STYLES[disclosure.level]}`}
        >
          {disclosure.badge}
        </span>
        <p className="mt-3 text-sm font-semibold text-ink">
          {disclosure.summary}
        </p>
      </div>

      <div className="grid gap-2 rounded-2xl border border-amber-200 bg-white/70 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-steel">
          What happens
        </p>
        <p className="text-sm text-ink">{disclosure.happens}</p>
      </div>

      <div className="grid gap-2 rounded-2xl border border-amber-200 bg-white/70 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-steel">
          What is shared
        </p>
        <ul className="grid list-disc gap-2 pl-5 text-sm text-ink">
          {disclosure.shared.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-steel">
          You are agreeing to
        </p>
        <p className="mt-2 text-sm text-ink">{disclosure.agreement}</p>
      </div>
    </div>
  );
}

export function ActionDisclosureSheet({
  disclosure,
  open,
  onConfirm,
  onCancel
}: {
  disclosure: ActionDisclosureContent;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet
      open={open}
      title={disclosure.title}
      onClose={onCancel}
      footer={
        <div className="grid gap-2">
          <Button size="lg" fullWidth onClick={onConfirm}>
            {disclosure.primaryLabel}
          </Button>
          <Button variant="ghost" fullWidth onClick={onCancel}>
            Cancel
          </Button>
        </div>
      }
    >
      <ActionDisclosurePanel disclosure={disclosure} />
    </Sheet>
  );
}
