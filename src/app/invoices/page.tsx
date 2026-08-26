import React, { Suspense } from 'react';
import { getInvoicesPagedAction } from '@/lib/actions/invoices';
import InvoicesClient from './InvoicesClient';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage() {
  const initialResult = await getInvoicesPagedAction({ page: 1, pageSize: 25 });
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-500">Loading invoices...</div>}>
      <InvoicesClient 
        initialInvoices={initialResult.data || []} 
        initialTotal={initialResult.total || 0}
        initialTotalPages={initialResult.totalPages || 1}
      />
    </Suspense>
  );
}
