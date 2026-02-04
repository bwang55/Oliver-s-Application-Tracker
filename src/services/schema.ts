import type { CustomField, CustomFieldType } from '../types';

export const FIELD_TYPES: { label: string; value: CustomFieldType }[] = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Date', value: 'date' },
  { label: 'URL', value: 'url' }
];

export function makeFieldId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || `field-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeCustomValues(
  custom: Record<string, string | number | null>,
  schema: CustomField[]
): Record<string, string | number | null> {
  const byName = new Map(
    schema.map((field) => [field.name.toLowerCase(), field.id])
  );
  const normalized: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(custom)) {
    const id = byName.get(key.toLowerCase()) ?? key;
    normalized[id] = value;
  }
  return normalized;
}
