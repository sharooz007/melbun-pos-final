import React from 'react';
import ExpenseDetailClient from './ExpenseDetailClient';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Expense Details - MelbunPOS',
};

export default function ExpenseDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="flex-1 overflow-y-auto bg-canvas pb-28">
      <ExpenseDetailClient id={params.id} />
    </div>
  );
}
