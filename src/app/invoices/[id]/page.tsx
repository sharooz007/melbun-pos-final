export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import React from 'react';
import InvoiceDetailClient from './InvoiceDetailClient';

export const metadata = {
  title: 'Invoice Details - MelbunPOS',
};

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  return <InvoiceDetailClient id={params.id} />;
}
