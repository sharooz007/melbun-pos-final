import React from 'react';
import CustomerDetailClient from './CustomerDetailClient';

export const runtime = 'edge';

export const metadata = {
  title: 'Customer Details - MelbunPOS',
};

export default function CustomerDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="h-full overflow-hidden flex flex-col bg-[#EFECE6] p-4 pb-28 lg:p-8">
      <div className="max-w-[1000px] w-full mx-auto flex-1 flex flex-col min-h-0">
        <CustomerDetailClient id={params.id} />
      </div>
    </div>
  );
}
