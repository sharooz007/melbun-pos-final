import React from 'react';
import CustomersClient from './CustomersClient';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Customers - MelbunPOS',
};

export default function CustomersPage() {
  return (
    <div className="flex-1 overflow-y-auto bg-canvas p-3.5 pb-36 sm:p-6 md:p-8 md:pb-8">
      <div className="max-w-6xl w-full mx-auto flex flex-col min-h-0 space-y-4">
        <h1 className="text-xl sm:text-2xl font-bold text-ink-primary">Customers Directory</h1>
        <CustomersClient />
      </div>
    </div>
  );
}
