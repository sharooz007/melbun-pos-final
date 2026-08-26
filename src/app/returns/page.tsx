import React, { Suspense } from 'react';
import ReturnsClient from './ReturnsClient';
import { Loader2 } from 'lucide-react';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Process Customer Returns - MelbunPOS',
};

export default function ReturnsPage() {
  return (
    <div className="flex-1 overflow-y-auto bg-canvas p-3.5 pb-36 sm:p-6 md:p-8 md:pb-8">
      <div className="max-w-6xl w-full mx-auto space-y-6">
        <Suspense fallback={
          <div className="p-12 flex flex-col justify-center items-center gap-2">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
            <p className="text-xs text-ink-muted">Loading returns engine...</p>
          </div>
        }>
          <ReturnsClient />
        </Suspense>
      </div>
    </div>
  );
}
