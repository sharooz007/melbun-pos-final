import { redirect } from 'next/navigation';

export default function BulkArrival() {
  redirect('/inventory/products?action=receive');
}
