import React from 'react';
import LedgerClient from './LedgerClient';
import { getStockLedgerAction } from '@/lib/actions/inventory';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export default async function LedgerPage() {
  const res = await getStockLedgerAction();
  if (!res.success) {
    return <div className="p-4 md:p-8 text-red-500">Error loading ledger: {res.error}</div>;
  }

  return (
    <div className="h-full overflow-hidden flex flex-col bg-[#EFECE6] p-6 lg:p-8">
      <div className="max-w-[1200px] w-full mx-auto flex-1 flex flex-col min-h-0">
        <LedgerClient initialData={res.data || []} initialPagination={res.pagination} />
      </div>
    </div>
  );
}
