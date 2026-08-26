import React from 'react';
import CustomersClient from './CustomersClient';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Customers - MelbunPOS',
};

export default function CustomersPage() {
  return (
    <div className="h-full overflow-hidden flex flex-col bg-[#EFECE6] p-4 pb-28 lg:p-8">
      <div className="max-w-[1000px] w-full mx-auto flex-1 flex flex-col min-h-0">
        <h1 className="text-[24px] font-bold text-ink-primary mb-6">Customers</h1>
        <CustomersClient />
      </div>
    </div>
  );
}
