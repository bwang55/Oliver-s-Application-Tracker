import { beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '../types';
import { applyAiActions } from './aiActions';

const JOBS_KEY = 'resumeTracker.jobs';
const SCHEMA_KEY = 'resumeTracker.schema';

type SchemaPayload = {
  customFields: Array<{ id: string; name: string; type: 'text' | 'number' | 'date' | 'url' }>;
};

function readJobs(): Job[] {
  const raw = localStorage.getItem(JOBS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Job[];
  } catch {
    return [];
  }
}

function readSchema(): SchemaPayload {
  const raw = localStorage.getItem(SCHEMA_KEY);
  if (!raw) return { customFields: [] };
  try {
    return JSON.parse(raw) as SchemaPayload;
  } catch {
    return { customFields: [] };
  }
}

describe('applyAiActions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('executes all action types successfully', async () => {
    let results = await applyAiActions(
      [{ type: 'add_custom_field', name: 'Source', fieldType: 'text' }],
      []
    );
    expect(results[0].ok).toBe(true);

    const schema = readSchema();
    expect(schema.customFields.length).toBe(1);
    const fieldId = schema.customFields[0].id;

    results = await applyAiActions(
      [
        {
          type: 'add_job',
          company: 'Shawmut Design and Construction',
          role: 'Intern/Coop - Software Development',
          status: 'applied',
          tags: ['email'],
          notes: ['auto-imported'],
          custom: { [fieldId]: 'Email' }
        }
      ],
      schema.customFields
    );
    expect(results[0].ok).toBe(true);

    let jobs = readJobs();
    expect(jobs.length).toBe(1);
    const jobId = jobs[0].id;

    results = await applyAiActions(
      [
        {
          type: 'update_job',
          id: jobId,
          role: 'Intern - Software Development',
          tags: ['email', 'portal'],
          notes: ['updated'],
          custom: { [fieldId]: 'Portal' }
        }
      ],
      schema.customFields
    );
    expect(results[0].ok).toBe(true);

    results = await applyAiActions(
      [{ type: 'set_status', id: jobId, status: 'interviewed' }],
      schema.customFields
    );
    expect(results[0].ok).toBe(true);

    results = await applyAiActions(
      [{ type: 'add_tag', id: jobId, tag: 'phone-screen' }],
      schema.customFields
    );
    expect(results[0].ok).toBe(true);

    results = await applyAiActions(
      [{ type: 'add_note', id: jobId, note: 'Recruiter replied.' }],
      schema.customFields
    );
    expect(results[0].ok).toBe(true);

    results = await applyAiActions(
      [{ type: 'delete_job', id: jobId }],
      schema.customFields
    );
    expect(results[0].ok).toBe(true);

    jobs = readJobs();
    expect(jobs.length).toBe(0);
  });
});
