import type { CustomField, Job, JobStatus, TimelineEvent } from '../types';
import { makeFieldId } from './schema';

const JOBS_KEY = 'resumeTracker.jobs';
const SCHEMA_KEY = 'resumeTracker.schema';
const STATUS_LABELS: Record<JobStatus, string> = {
  applied: 'Applied',
  interviewed: 'Interviewing',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  archived: 'Archived'
};

type SchemaPayload = {
  customFields: CustomField[];
};

type Listener<T> = (value: T) => void;

const jobListeners = new Set<Listener<Job[]>>();
const schemaListeners = new Set<Listener<CustomField[]>>();
let storageListenerAttached = false;

export type JobInput = {
  company: string;
  role: string;
  status?: JobStatus;
  appliedDate?: string;
  tags?: string[];
  notes?: string[];
  custom?: Record<string, string | number | null>;
};

export function subscribeJobs(onChange: (jobs: Job[]) => void) {
  jobListeners.add(onChange);
  onChange(loadJobs());
  attachStorageListener();
  return () => {
    jobListeners.delete(onChange);
  };
}

export function subscribeSchema(onChange: (fields: CustomField[]) => void) {
  schemaListeners.add(onChange);
  onChange(loadSchema());
  attachStorageListener();
  return () => {
    schemaListeners.delete(onChange);
  };
}

export async function addJob(input: JobInput) {
  const jobs = loadJobs();
  const status = input.status ?? 'applied';
  const now = timestamp();
  const timeline: TimelineEvent[] = [
    createTimelineEvent('created', `Created`, now)
  ];
  timeline.push(
    createTimelineEvent('status_changed', `${STATUS_LABELS[status]}`, now)
  );
  if (input.appliedDate) {
    timeline.push(
      createTimelineEvent(
        'applied_date_updated',
        `Applied date: ${input.appliedDate}`,
        now
      )
    );
  }
  const job: Job = {
    id: createId(),
    company: input.company,
    role: input.role,
    status,
    appliedDate: input.appliedDate ?? '',
    tags: input.tags ?? [],
    notes: input.notes ?? [],
    custom: input.custom ?? {},
    timeline,
    createdAt: now,
    updatedAt: now
  };
  saveJobs([job, ...jobs]);
  return job.id;
}

export async function updateJob(id: string, input: Partial<JobInput>) {
  const jobs = loadJobs();
  const updated = jobs.map((job) => {
    if (job.id !== id) return job;
    const mergedCustom = input.custom
      ? { ...job.custom, ...input.custom }
      : job.custom;
    const now = timestamp();
    const timeline = ensureTimeline(job);
    const nextAppliedDate =
      input.appliedDate !== undefined ? input.appliedDate : job.appliedDate;
    if (input.status && input.status !== job.status) {
      timeline.push(
        createTimelineEvent(
          'status_changed',
          `${STATUS_LABELS[input.status] ?? input.status}`,
          now
        )
      );
    }
    if (input.appliedDate !== undefined && nextAppliedDate !== job.appliedDate) {
      timeline.push(
        createTimelineEvent(
          'applied_date_updated',
          `Applied date: ${nextAppliedDate || 'unknown'}`,
          now
        )
      );
    }
    return {
      ...job,
      ...stripUndefined(input),
      custom: mergedCustom,
      timeline,
      updatedAt: now
    };
  });
  saveJobs(updated);
}

export async function deleteJob(id: string) {
  const jobs = loadJobs().filter((job) => job.id !== id);
  saveJobs(jobs);
}

export async function setStatus(id: string, status: JobStatus) {
  const jobs = loadJobs();
  const updated = jobs.map((job) => {
    if (job.id !== id) return job;
    if (job.status === status) return job;
    const now = timestamp();
    const timeline = ensureTimeline(job);
    timeline.push(
      createTimelineEvent('status_changed', `${STATUS_LABELS[status]}`, now)
    );
    return {
      ...job,
      status,
      timeline,
      updatedAt: now
    };
  });
  saveJobs(updated);
}

export async function addTag(id: string, tag: string) {
  const jobs = loadJobs();
  const updated = jobs.map((job) => {
    if (job.id !== id) return job;
    const nextTags = new Set(job.tags ?? []);
    nextTags.add(tag);
    const now = timestamp();
    const timeline = ensureTimeline(job);
    if (!job.tags?.includes(tag)) {
      timeline.push(
        createTimelineEvent('tag_added', `Tag added`, now)
      );
    }
    return {
      ...job,
      tags: Array.from(nextTags),
      timeline,
      updatedAt: now
    };
  });
  saveJobs(updated);
}

export async function addNote(id: string, note: string) {
  const jobs = loadJobs();
  const updated = jobs.map((job) => {
    if (job.id !== id) return job;
    const now = timestamp();
    return {
      ...job,
      notes: [...(job.notes ?? []), note],
      updatedAt: now
    };
  });
  saveJobs(updated);
}

export async function setNote(id: string, note: string | null) {
  const jobs = loadJobs();
  const updated = jobs.map((job) => {
    if (job.id !== id) return job;
    const now = timestamp();
    return {
      ...job,
      notes: note ? [note] : [],
      updatedAt: now
    };
  });
  saveJobs(updated);
}

export async function setCustomFieldValue(
  id: string,
  fieldId: string,
  value: string | number | null
) {
  const jobs = loadJobs();
  const updated = jobs.map((job) => {
    if (job.id !== id) return job;
    const now = timestamp();
    const timeline = ensureTimeline(job);
    timeline.push(
      createTimelineEvent('custom_updated', `Custom updated`, now)
    );
    return {
      ...job,
      custom: {
        ...job.custom,
        [fieldId]: value
      },
      timeline,
      updatedAt: now
    };
  });
  saveJobs(updated);
}

export async function upsertCustomField(
  name: string,
  type: CustomField['type']
) {
  const schema = loadSchema();
  const id = makeFieldId(name);
  const exists = schema.find((field) => field.id === id);
  let updated: CustomField[];
  if (exists) {
    updated = schema.map((field) =>
      field.id === id ? { ...field, name, type } : field
    );
  } else {
    updated = [...schema, { id, name, type }];
  }
  saveSchema(updated);
  return id;
}

function loadJobs(): Job[] {
  const raw = localStorage.getItem(JOBS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Job[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((job) => ({
      ...job,
      timeline: ensureTimeline(job)
    }));
  } catch {
    return [];
  }
}

function saveJobs(jobs: Job[]) {
  localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
  notifyJobs(jobs);
}

function loadSchema(): CustomField[] {
  const raw = localStorage.getItem(SCHEMA_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SchemaPayload;
    return Array.isArray(parsed?.customFields) ? parsed.customFields : [];
  } catch {
    return [];
  }
}

function saveSchema(fields: CustomField[]) {
  const payload: SchemaPayload = { customFields: fields };
  localStorage.setItem(SCHEMA_KEY, JSON.stringify(payload));
  notifySchema(fields);
}

function notifyJobs(jobs: Job[]) {
  jobListeners.forEach((listener) => listener(jobs));
}

function notifySchema(fields: CustomField[]) {
  schemaListeners.forEach((listener) => listener(fields));
}

function attachStorageListener() {
  if (storageListenerAttached || typeof window === 'undefined') return;
  storageListenerAttached = true;
  window.addEventListener('storage', (event) => {
    if (event.key === JOBS_KEY) {
      notifyJobs(loadJobs());
    }
    if (event.key === SCHEMA_KEY) {
      notifySchema(loadSchema());
    }
  });
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `job-${Math.random().toString(36).slice(2, 10)}`;
}

function timestamp() {
  return new Date().toISOString();
}

function createTimelineEvent(
  type: TimelineEvent['type'],
  label: string,
  createdAt: string
): TimelineEvent {
  return {
    id: createId(),
    type,
    label,
    createdAt
  };
}

function ensureTimeline(job: Job): TimelineEvent[] {
  return Array.isArray(job.timeline) ? [...job.timeline] : [];
}

function summarize(text: string) {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 45)}...`;
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  const next = { ...input } as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) delete next[key];
  }
  return next as T;
}
