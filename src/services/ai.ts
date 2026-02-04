import type { CustomField, Job, JobStatus } from '../types';

export type AiSettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type AiAction =
  | {
      type: 'add_job';
      company: string;
      role: string;
      status?: JobStatus;
      appliedDate?: string;
      tags?: string[];
      notes?: string[];
      custom?: Record<string, string | number | null>;
    }
  | {
      type: 'update_job';
      id: string;
      company?: string;
      role?: string;
      status?: JobStatus;
      appliedDate?: string;
      tags?: string[];
      notes?: string[];
      custom?: Record<string, string | number | null>;
    }
  | { type: 'set_status'; id: string; status: JobStatus }
  | { type: 'add_tag'; id: string; tag: string }
  | { type: 'add_note'; id: string; note: string }
  | { type: 'add_custom_field'; name: string; fieldType: CustomField['type'] }
  | { type: 'delete_job'; id: string };

export type AiResponse = {
  summary?: string;
  actions: AiAction[];
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  apiKey: '',
  baseUrl: 'https://api.openai.com',
  model: 'gpt-4o-mini'
};

export const AI_DEBUG = true;

function debugLog(...args: unknown[]) {
  if (!AI_DEBUG) return;
  console.info('[AI]', ...args);
}

const ACTION_TYPES = new Set<AiAction['type']>([
  'add_job',
  'update_job',
  'set_status',
  'add_tag',
  'add_note',
  'add_custom_field',
  'delete_job'
]);

const STATUS_TYPES = new Set<JobStatus>([
  'applied',
  'rejected',
  'interviewed',
  'offer',
  'accepted',
  'archived'
]);

const FIELD_TYPES = new Set<CustomField['type']>([
  'text',
  'number',
  'date',
  'url'
]);

export function buildAiPrompt(jobs: Job[], fields: CustomField[], input: string) {
  const jobLines = jobs.map(
    (job) =>
      `- id: ${job.id}, company: ${job.company}, role: ${job.role}, status: ${job.status}, appliedDate: ${job.appliedDate ?? ''}`
  );
  const fieldLines = fields.map(
    (field) => `- ${field.name} (id: ${field.id}, type: ${field.type})`
  );

  const system = `You are a resume tracker assistant. Output JSON only, no Markdown or explanations.\n\nThe user input may be a pasted email or webpage. Detect what it is and extract actionable info. Common intents:\n- rejection email -> set_status to rejected\n- interview invitation -> set_status to interviewed\n- offer email -> set_status to offer\n- acceptance/offer accepted -> set_status to accepted\n\nIf the input contains a company and role that match an existing job, update that job. If you cannot confidently match a job id, do not output actions.\n\nReturn the structure:\n{\n  \"summary\": \"short summary\",\n  \"actions\": [\n    { \"type\": \"add_job\", ... },\n    { \"type\": \"set_status\", ... }\n  ]\n}\n\nAllowed actions:\n- add_job: { type, company, role, status, appliedDate, tags, notes, custom }\n- update_job: { type, id, company, role, status, appliedDate, tags, notes, custom }\n- set_status: { type, id, status }\n- add_tag: { type, id, tag }\n- add_note: { type, id, note }\n- add_custom_field: { type, name, fieldType }\n- delete_job: { type, id }\n\nRules:\n1) Each action must have a top-level \"type\" field. Do not nest actions under keys like \"add_job\".\n2) status must be one of applied / rejected / interviewed / offer / accepted / archived\n3) custom keys must match existing field ids or field names (or add_custom_field first)\n4) If you cannot determine the id, do not output that action\n5) actions can be an empty array`;

  const user = `Current jobs:\n${jobLines.length ? jobLines.join('\n') : '- (none)'}\n\nCustom fields:\n${fieldLines.length ? fieldLines.join('\n') : '- (none)'}\n\nUser input:\n${input}`;

  return { system, user };
}

export async function requestAiActions(
  settings: AiSettings,
  jobs: Job[],
  fields: CustomField[],
  input: string
): Promise<AiResponse> {
  const { system, user } = buildAiPrompt(jobs, fields, input);
  debugLog('request', { model: settings.model, baseUrl: settings.baseUrl });
  debugLog('prompt', { system, user });

  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'AI request failed');
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content ?? '';
  debugLog('raw', content);
  const parsed = safeParseJson(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI output is not valid JSON');
  }

  const result = normalizeAiResponse(parsed);
  debugLog('parsed', result);
  return result;
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return null;
    }
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeAiResponse(raw: unknown): AiResponse {
  if (!raw || typeof raw !== 'object') {
    return { actions: [] };
  }
  const record = raw as Record<string, unknown>;
  const summary = typeof record.summary === 'string' ? record.summary : undefined;
  const rawActions = Array.isArray(record.actions) ? record.actions : [];
  const actions = rawActions
    .map(normalizeAction)
    .filter((action): action is AiAction => Boolean(action));
  return { summary, actions };
}

function normalizeAction(raw: unknown): AiAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const directType = typeof record.type === 'string' ? record.type : null;

  if (directType && ACTION_TYPES.has(directType as AiAction['type'])) {
    return sanitizeAction({
      ...(record as Record<string, unknown>),
      type: directType
    } as AiAction);
  }

  const keys = Object.keys(record);
  if (keys.length === 1 && ACTION_TYPES.has(keys[0] as AiAction['type'])) {
    const payload = record[keys[0]];
    if (!payload || typeof payload !== 'object') return null;
    const { type: _ignored, ...rest } = payload as Record<string, unknown>;
    return sanitizeAction({
      type: keys[0] as AiAction['type'],
      ...(rest as Record<string, unknown>)
    } as AiAction);
  }

  return null;
}

function sanitizeAction(action: AiAction): AiAction | null {
  switch (action.type) {
    case 'add_job': {
      const company = toText(action.company);
      const role = toText(action.role);
      if (!company || !role) return null;
      return {
        type: 'add_job',
        company,
        role,
        status: toStatus(action.status),
        appliedDate: toOptionalText(action.appliedDate),
        tags: toStringArray(action.tags),
        notes: toStringArray(action.notes),
        custom: toCustom(action.custom)
      };
    }
    case 'update_job': {
      const id = toText(action.id);
      if (!id) return null;
      return {
        type: 'update_job',
        id,
        company: toOptionalText(action.company),
        role: toOptionalText(action.role),
        status: toStatus(action.status),
        appliedDate: toOptionalText(action.appliedDate),
        tags: toStringArray(action.tags),
        notes: toStringArray(action.notes),
        custom: toCustom(action.custom)
      };
    }
    case 'set_status': {
      const id = toText(action.id);
      const status = toStatus(action.status);
      if (!id || !status) return null;
      return { type: 'set_status', id, status };
    }
    case 'add_tag': {
      const id = toText(action.id);
      const tag = toText(action.tag);
      if (!id || !tag) return null;
      return { type: 'add_tag', id, tag };
    }
    case 'add_note': {
      const id = toText(action.id);
      const note = toText(action.note);
      if (!id || !note) return null;
      return { type: 'add_note', id, note };
    }
    case 'add_custom_field': {
      const name = toText(action.name);
      if (!name) return null;
      const fieldType = FIELD_TYPES.has(action.fieldType)
        ? action.fieldType
        : 'text';
      return { type: 'add_custom_field', name, fieldType };
    }
    case 'delete_job': {
      const id = toText(action.id);
      if (!id) return null;
      return { type: 'delete_job', id };
    }
    default:
      return null;
  }
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toStatus(value: unknown): JobStatus | undefined {
  if (typeof value !== 'string') return undefined;
  return STATUS_TYPES.has(value as JobStatus) ? (value as JobStatus) : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.trim());
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return undefined;
}

function toCustom(
  value: unknown
): Record<string, string | number | null> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string | number | null> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry === 'string' || typeof entry === 'number') {
      result[key] = entry;
    }
  }
  return Object.keys(result).length ? result : undefined;
}
