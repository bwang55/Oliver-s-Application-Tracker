export type JobStatus =
  | 'applied'
  | 'rejected'
  | 'interviewed'
  | 'offer'
  | 'accepted'
  | 'archived';

export type CustomFieldType = 'text' | 'number' | 'date' | 'url';

export type CustomField = {
  id: string;
  name: string;
  type: CustomFieldType;
};

export type TimelineEventType =
  | 'created'
  | 'status_changed'
  | 'note_added'
  | 'tag_added'
  | 'applied_date_updated'
  | 'custom_updated';

export type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  label: string;
  createdAt: string;
};

export type Job = {
  id: string;
  company: string;
  role: string;
  status: JobStatus;
  appliedDate?: string;
  tags: string[];
  notes: string[];
  custom: Record<string, string | number | null>;
  timeline?: TimelineEvent[];
  createdAt?: string;
  updatedAt?: string;
};
