export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';

export default function InventoryPage() {
  redirect('/inventory/products');
}
