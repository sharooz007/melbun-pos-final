import React from 'react';
import CustomerDetailClient from './CustomerDetailClient';

export const runtime = 'edge';

export const metadata = {
  title: 'Customer Details - MelbunPOS',
};

export default function CustomerDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="flex-1 overflow-y-auto bg-canvas pb-28">
      <CustomerDetailClient id={params.id} />
    </div>
  );
}
