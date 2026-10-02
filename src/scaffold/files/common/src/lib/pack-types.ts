/* What the browser may know about the pack. Plain data only: no functions, no keys. */
export interface FieldInfo {
  name: string;
  label?: string;
  type?: 'text' | 'textarea' | 'email' | 'number' | 'integer' | 'select' | 'checkbox' | 'list' | 'file';
  required?: boolean;
  help?: string;
  min?: number;
  max?: number;
  options?: Array<string | { value: string; label: string }>;
  of?: FieldInfo[];
  slot?: string;
}

export interface PackInfo {
  id: string;
  name: string;
  tagline: string;
  url: string | null;
  fields: FieldInfo[];
  documents: Array<{ slot: string; mime: string[] }>;
  prices: Array<{ id: string; name: string; amount: number; mode: string }>;
  stages: Array<{ id: string; label: string }>;
  narratives: string[];
  devCheckout: boolean;
}

export const money = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : `$${(cents / 100).toFixed(2)}`);

export const MIME_NAMES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/webp': 'WEBP',
  'text/csv': 'CSV',
};

export const sentenceCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
