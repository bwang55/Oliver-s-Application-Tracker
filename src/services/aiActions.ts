import type { CustomField, JobStatus } from '../types';
import type { AiAction } from './ai';
import {
  addJob,
  addNote,
  deleteJob,
  setStatus,
  updateJob,
  upsertCustomField
} from './jobs';
import { normalizeCustomValues } from './schema';

export type ActionResult = {
  action: AiAction;
  ok: boolean;
  message: string;
};

const allowedStatuses: JobStatus[] = [
  'applied',
  'rejected',
  'interviewed',
  'offer',
  'accepted',
  'archived'
];

export async function applyAiActions(
  actions: AiAction[],
  fields: CustomField[]
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'add_job': {
          if (!action.company || !action.role) {
            throw new Error('Missing company or role');
          }
          const custom = action.custom
            ? normalizeCustomValues(action.custom, fields)
            : undefined;
          await addJob({
            company: action.company,
            role: action.role,
            status: normalizeStatus(action.status),
            appliedDate: action.appliedDate,
            notes: action.notes,
            custom
          });
          results.push({ action, ok: true, message: 'Job added' });
          break;
        }
        case 'update_job': {
          if (!action.id) {
            throw new Error('Missing id');
          }
          const custom = action.custom
            ? normalizeCustomValues(action.custom, fields)
            : undefined;
          await updateJob(action.id, {
            company: action.company,
            role: action.role,
            status: normalizeStatus(action.status),
            appliedDate: action.appliedDate,
            notes: action.notes,
            custom
          });
          results.push({ action, ok: true, message: 'Job updated' });
          break;
        }
        case 'set_status': {
          if (!action.id || !action.status) {
            throw new Error('Missing id or status');
          }
          const normalized = normalizeStatus(action.status);
          if (!normalized) {
            throw new Error('Invalid status');
          }
          await setStatus(action.id, normalized);
          results.push({ action, ok: true, message: 'Status updated' });
          break;
        }
        case 'add_note': {
          if (!action.id || !action.note) {
            throw new Error('Missing id or note');
          }
          await addNote(action.id, action.note);
          results.push({ action, ok: true, message: 'Note added' });
          break;
        }
        case 'add_custom_field': {
          if (!action.name || !action.fieldType) {
            throw new Error('Missing name or fieldType');
          }
          await upsertCustomField(action.name, action.fieldType);
          results.push({ action, ok: true, message: 'Field added' });
          break;
        }
        case 'delete_job': {
          if (!action.id) {
            throw new Error('Missing id');
          }
          await deleteJob(action.id);
          results.push({ action, ok: true, message: 'Job deleted' });
          break;
        }
        default: {
          results.push({
            action,
            ok: false,
            message: `Unsupported action: ${(action as AiAction).type}`
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed';
      results.push({ action, ok: false, message });
    }
  }
  return results;
}

function normalizeStatus(status?: JobStatus): JobStatus | undefined {
  if (!status) return undefined;
  return allowedStatuses.includes(status) ? status : undefined;
}
