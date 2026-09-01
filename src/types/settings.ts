export type VariantTemplateItem = string | { name: string; pieces_per_set?: number };

export interface VariantTemplate {
  id: string;
  name: string;
  variants: VariantTemplateItem[];
}

export interface StoreSettings {
  id: string;
  store_name: string;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  business_day_start_hour: number; // 0 to 23
  timezone: string; // e.g. 'Asia/Kolkata'
  whatsapp_invoice_template?: string | null;
  whatsapp_due_reminder_template?: string | null;
  variant_templates?: VariantTemplate[] | null;
  created_at: string;
  updated_at: string;
}
