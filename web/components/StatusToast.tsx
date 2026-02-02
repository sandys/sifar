'use client';

import { Toast } from '@/components/ui/Toast';
import { useAppStore } from '@/lib/store';

export function StatusToast() {
  const { statusMessage } = useAppStore();
  return <Toast message={statusMessage} tone="info" />;
}
