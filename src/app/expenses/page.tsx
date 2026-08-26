import React from 'react';
import ExpensesClient from './ExpensesClient';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Expenses Management - MelbunPOS',
};

export default function ExpensesPage() {
  return (
    <div className="flex-1 overflow-y-auto bg-canvas p-4 pb-28 md:p-6 lg:p-8">
      <div className="max-w-6xl w-full mx-auto flex flex-col min-h-0 space-y-4">
        <h1 className="text-xl sm:text-2xl font-bold text-ink-primary">Expenses Ledger</h1>
        <ExpensesClient />
      </div>
    </div>
  );
}
