import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomField, CustomFieldType, Job, JobStatus } from './types';
import {
  addJob,
  deleteJob,
  setNote,
  setStatus,
  subscribeJobs,
  subscribeSchema,
  updateJob,
  upsertCustomField
} from './services/jobs';
import {
  AI_DEBUG,
  DEFAULT_AI_SETTINGS,
  requestAiActions,
  type AiResponse,
  type AiSettings
} from './services/ai';
import { applyAiActions, type ActionResult } from './services/aiActions';
import { FIELD_TYPES } from './services/schema';

const AI_SETTINGS_KEY = 'resumeTracker.aiSettings';
const THEME_KEY = 'resumeTracker.theme';

type ThemeMode = 'light' | 'dark';

const statusOptions: { value: JobStatus; label: string }[] = [
  { value: 'applied', label: 'Applied' },
  { value: 'interviewed', label: 'Interviewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'archived', label: 'Archived' }
];

const settingsSections = [
  { id: 'ai', label: 'AI' },
  { id: 'data', label: 'Import & Export' },
  { id: 'fields', label: 'Custom Fields' },
  { id: 'about', label: 'About' }
] as const;

type SettingsSection = (typeof settingsSections)[number]['id'];

const sortOptions = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'company', label: 'Company A-Z' },
  { value: 'status', label: 'Status' },
  { value: 'appliedDate', label: 'Applied date' }
] as const;

type SortMode = (typeof sortOptions)[number]['value'];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  const flushCell = () => {
    row.push(current);
    current = '';
  };

  const flushRow = () => {
    if (row.length > 0 || current.length > 0) {
      flushCell();
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === '\n' && !inQuotes) {
      flushRow();
      continue;
    }
    if (char === '\r' && !inQuotes) {
      if (next === '\n') {
        i += 1;
      }
      flushRow();
      continue;
    }
    if (char === ',' && !inQuotes) {
      flushCell();
      continue;
    }
    current += char;
  }
  flushRow();
  return rows;
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const statusLabelMap = statusOptions.reduce<Record<JobStatus, string>>(
  (acc, option) => {
    acc[option.value] = option.label;
    return acc;
  },
  {
    applied: 'Applied',
    interviewed: 'Interviewing',
    offer: 'Offer',
    accepted: 'Accepted',
    rejected: 'Rejected',
    archived: 'Archived'
  }
);

const allowedStatuses: JobStatus[] = [
  'applied',
  'rejected',
  'interviewed',
  'offer',
  'accepted',
  'archived'
];

function loadAiSettings(): AiSettings {
  const raw = localStorage.getItem(AI_SETTINGS_KEY);
  if (!raw) return DEFAULT_AI_SETTINGS;
  try {
    return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) } as AiSettings;
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  if (typeof window !== 'undefined') {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    if (prefersDark) return 'dark';
  }
  return 'light';
}

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [formCompany, setFormCompany] = useState('');
  const [formRole, setFormRole] = useState('');
  const [formStatus, setFormStatus] = useState<JobStatus>('applied');
  const [formDate, setFormDate] = useState('');

  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<CustomFieldType>('text');

  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [searchQuery, setSearchQuery] = useState('');

  const [aiInput, setAiInput] = useState('');
  const [aiSettings, setAiSettings] = useState<AiSettings>(loadAiSettings);
  const [aiResult, setAiResult] = useState<AiResponse | null>(null);
  const [aiActionsApplied, setAiActionsApplied] = useState<ActionResult[] | null>(
    null
  );
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>('ai');
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [composerProgress, setComposerProgress] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeComposer = () => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = '0px';
    const nextHeight = el.scrollHeight;
    const maxHeight = 220;
    el.style.height = `${Math.min(nextHeight, maxHeight)}px`;
    el.style.overflowY = nextHeight > maxHeight ? 'auto' : 'hidden';
  };

  const formatTimeline = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const datePart = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
    const timePart = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
    return `${datePart} · ${timePart}`;
  };

  const getStatusLabel = (status: JobStatus) => statusLabelMap[status] ?? status;

  const normalizeStatus = (value?: string): JobStatus | undefined => {
    if (!value) return undefined;
    const normalized = value.toLowerCase().trim() as JobStatus;
    return allowedStatuses.includes(normalized) ? normalized : undefined;
  };

  useEffect(() => {
    const unsubJobs = subscribeJobs(setJobs);
    const unsubSchema = subscribeSchema(setFields);
    return () => {
      unsubJobs();
      unsubSchema();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(aiSettings));
  }, [aiSettings]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    resizeComposer();
  }, [aiInput]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let rafId = 0;
    const handleScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        const next = Math.min(1, el.scrollTop / 160);
        setComposerProgress((prev) =>
          Math.abs(prev - next) > 0.01 ? next : prev
        );
        rafId = 0;
      });
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: jobs.length };
    statusOptions.forEach((option) => {
      counts[option.value] = jobs.filter((job) => job.status === option.value).length;
    });
    return counts;
  }, [jobs]);

  const filteredJobs = useMemo(() => {
      const query = searchQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      if (statusFilter !== 'all' && job.status !== statusFilter) return false;
      if (!query) return true;
      const haystack = [
        job.company,
        job.role,
        job.notes?.join(' ') ?? ''
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [jobs, statusFilter, searchQuery]);

  const jobCountLabel = useMemo(() => {
    const total = jobs.length;
    const rejected = jobs.filter((job) => job.status === 'rejected').length;
    const isFiltering =
      statusFilter !== 'all' || Boolean(searchQuery.trim());
    if (!isFiltering) {
      return `${total} applications · ${rejected} rejected`;
    }
    const shown = filteredJobs.length;
    return `${shown} shown · ${total} total`;
  }, [jobs, statusFilter, searchQuery, filteredJobs]);

  const sortedJobs = useMemo(() => {
    const items = [...filteredJobs];
    const statusOrder = statusOptions.map((option) => option.value);
    const getTime = (job: Job) =>
      new Date(job.updatedAt ?? job.createdAt ?? 0).getTime();
    const getApplied = (job: Job) =>
      job.appliedDate ? new Date(job.appliedDate).getTime() : 0;

    switch (sortMode) {
      case 'company':
        items.sort((a, b) => a.company.localeCompare(b.company));
        break;
      case 'status':
        items.sort(
          (a, b) =>
            statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
        );
        break;
      case 'appliedDate':
        items.sort((a, b) => getApplied(b) - getApplied(a));
        break;
      case 'recent':
      default:
        items.sort((a, b) => getTime(b) - getTime(a));
        break;
    }
    return items;
  }, [filteredJobs, sortMode]);

  const handleAddJob = async () => {
    if (!formCompany.trim() || !formRole.trim()) return;
    await addJob({
      company: formCompany.trim(),
      role: formRole.trim(),
      status: formStatus,
      appliedDate: formDate
    });
    setFormCompany('');
    setFormRole('');
    setFormDate('');
  };

  const handleAddField = async () => {
    if (!fieldName.trim()) return;
    await upsertCustomField(fieldName.trim(), fieldType);
    setFieldName('');
  };

  const handleSend = async () => {
    setAiError(null);
    setAiActionsApplied(null);
    setAiResult(null);
    if (!aiSettings.apiKey || !aiSettings.baseUrl || !aiSettings.model) {
      setAiError('Please fill in API Key, Base URL, and Model.');
      return;
    }
    const input = aiInput.trim();
    if (!input) return;
    setAiInput('');
    resizeComposer();
    setAiLoading(true);
    try {
      const result = await requestAiActions(
        aiSettings,
        jobs,
        fields,
        input
      );
      setAiResult(result);
      if (result.actions?.length) {
        const results = await applyAiActions(result.actions, fields);
        setAiActionsApplied(results);
        if (AI_DEBUG) {
          console.info('[AI] applied', results);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI request failed';
      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleImportFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    setImportNotice(null);
    try {
      const text = await file.text();
      const extension = file.name.split('.').pop()?.toLowerCase();
      let inputs: Array<{
        company?: string;
        role?: string;
        status?: JobStatus;
        appliedDate?: string;
        note?: string;
      }> = [];

      if (extension === 'json') {
        const parsed = JSON.parse(text);
        const rawJobs = Array.isArray(parsed) ? parsed : parsed?.jobs;
        if (!Array.isArray(rawJobs)) {
          throw new Error('JSON must be an array or contain a jobs array.');
        }
        inputs = rawJobs.map((job: any) => ({
          company: job.company ?? job.Company,
          role: job.role ?? job.Role,
          status: normalizeStatus(job.status ?? job.Status),
          appliedDate: job.appliedDate ?? job.applied_date ?? job.AppliedDate,
          note:
            job.note ??
            job.Note ??
            (Array.isArray(job.notes) ? job.notes[0] : job.notes)
        }));
      } else if (extension === 'csv') {
        const rows = parseCsv(text);
        if (rows.length < 2) {
          throw new Error('CSV must include a header and at least one row.');
        }
        const headers = rows[0].map((cell) => cell.trim().toLowerCase());
        inputs = rows.slice(1).map((row) => {
          const get = (name: string) => {
            const index = headers.indexOf(name);
            return index >= 0 ? row[index]?.trim() : '';
          };
          return {
            company: get('company'),
            role: get('role'),
            status: normalizeStatus(get('status')),
            appliedDate: get('applieddate') || get('applied_date'),
            note: get('note')
          };
        });
      } else {
        throw new Error('Please upload a CSV or JSON file.');
      }

      let added = 0;
      for (const input of inputs) {
        if (!input.company || !input.role) continue;
        await addJob({
          company: input.company,
          role: input.role,
          status: input.status,
          appliedDate: input.appliedDate,
          notes: input.note ? [input.note] : undefined
        });
        added += 1;
      }
      setImportNotice(
        added > 0
          ? `Imported ${added} application${added === 1 ? '' : 's'}.`
          : 'No valid rows to import.'
      );
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Import failed.';
      setImportNotice(message);
    }
  };

  const handleExportJson = () => {
    const payload = {
      jobs,
      fields
    };
    downloadFile(
      JSON.stringify(payload, null, 2),
      'application-tracker.json',
      'application/json'
    );
  };

  const handleDownloadTemplate = () => {
    const header = ['company', 'role', 'status', 'appliedDate', 'note'];
    const csv = `${header.join(',')}\n`;
    downloadFile(csv, 'application-tracker-template.csv', 'text/csv');
  };

  const handleDeleteJob = async (id: string) => {
    const confirmed = window.confirm(
      'Delete this application? This cannot be undone.'
    );
    if (!confirmed) return;
    await deleteJob(id);
    if (expandedId === id) {
      setExpandedId(null);
    }
  };

  const appliedSummary = useMemo(() => {
    if (!aiActionsApplied) return null;
    const success = aiActionsApplied.filter((result) => result.ok).length;
    const failed = aiActionsApplied.length - success;
    if (aiActionsApplied.length === 0) return 'No actions applied.';
    if (failed === 0) {
      return `Applied ${success} action${success === 1 ? '' : 's'}.`;
    }
    if (success === 0) {
      return `${failed} action${failed === 1 ? '' : 's'} failed.`;
    }
    return `Applied ${success} action${success === 1 ? '' : 's'}, ${failed} failed.`;
  }, [aiActionsApplied]);

  const aiNotice = useMemo(() => {
    const raw = aiError ?? aiResult?.summary ?? appliedSummary ?? null;
    if (!raw) return null;
    const trimmed = raw.trim();
    if (trimmed.length > 180) {
      return `${trimmed.slice(0, 177)}...`;
    }
    return trimmed;
  }, [aiError, aiResult, appliedSummary]);

  return (
    <div className="app-shell">
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Workspace</h2>
          </div>
          <button className="icon-button" onClick={() => setSidebarOpen(false)}>
            Close
          </button>
        </div>

        <div className="theme-row">
          <span>Dark mode</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={theme === 'dark'}
              onChange={(event) =>
                setTheme(event.target.checked ? 'dark' : 'light')
              }
              aria-label="Toggle dark mode"
            />
            <span className="slider" />
          </label>
        </div>

        <div className="sidebar-tabs">
          {settingsSections.map((section) => (
            <button
              key={section.id}
              className={`tab ${
                settingsSection === section.id ? 'active' : ''
              }`}
              onClick={() => setSettingsSection(section.id)}
            >
              {section.label}
            </button>
          ))}
        </div>

        <div className="sidebar-detail">
          {settingsSection === 'ai' && (
            <div className="detail-section">
              <h3>AI Settings</h3>
              <label>
                API Key
                <input
                  placeholder="sk-..."
                  value={aiSettings.apiKey}
                  onChange={(event) =>
                    setAiSettings((prev) => ({
                      ...prev,
                      apiKey: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Base URL
                <input
                  placeholder="https://api.openai.com"
                  value={aiSettings.baseUrl}
                  onChange={(event) =>
                    setAiSettings((prev) => ({
                      ...prev,
                      baseUrl: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                Model
                <input
                  placeholder="gpt-4o-mini"
                  value={aiSettings.model}
                  onChange={(event) =>
                    setAiSettings((prev) => ({
                      ...prev,
                      model: event.target.value
                    }))
                  }
                />
              </label>
              <p className="muted">
                Compatible with any OpenAI-style endpoint.
              </p>
            </div>
          )}

          {settingsSection === 'fields' && (
            <div className="detail-section">
              <h3>Custom Fields</h3>
              <div className="stack">
                <input
                  placeholder="Field name"
                  value={fieldName}
                  onChange={(event) => setFieldName(event.target.value)}
                />
                <select
                  value={fieldType}
                  onChange={(event) =>
                    setFieldType(event.target.value as CustomFieldType)
                  }
                >
                  {FIELD_TYPES.map((field) => (
                    <option key={field.value} value={field.value}>
                      {field.label}
                    </option>
                  ))}
                </select>
                <button className="primary" onClick={handleAddField}>
                  Add field
                </button>
              </div>
              <div className="field-list">
                {fields.map((field) => (
                  <div key={field.id} className="field-item">
                    <div>
                      <strong>{field.name}</strong>
                      <p className="muted">{field.id}</p>
                    </div>
                    <span className="pill">{field.type}</span>
                  </div>
                ))}
                {fields.length === 0 && (
                  <p className="muted">No custom fields yet.</p>
                )}
              </div>
            </div>
          )}

          {settingsSection === 'data' && (
            <div className="detail-section">
              <h3>Import & Export</h3>
              <div
                className={`dropzone ${dragActive ? 'active' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  handleImportFiles(event.dataTransfer.files);
                }}
                onClick={() => importInputRef.current?.click()}
              >
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv,application/json"
                  onChange={(event) => handleImportFiles(event.target.files)}
                />
                <p>
                  Drop a CSV or JSON file here, or click to browse.
                </p>
                <span className="muted">
                  Required columns: company, role. Optional: status, appliedDate, note.
                </span>
              </div>
              {importNotice && <p className="muted">{importNotice}</p>}
              <div className="stack">
                <button className="primary" onClick={handleExportJson}>
                  Download JSON export
                </button>
                <button className="ghost" onClick={handleDownloadTemplate}>
                  Download CSV template
                </button>
              </div>
            </div>
          )}

          {settingsSection === 'about' && (
            <div className="detail-section">
              <h3>About</h3>
              <p className="muted">
                Data is stored locally in your browser. No server required.
              </p>
              <p className="muted">
                Use the AI assistant to add jobs, update status, or add fields.
              </p>
            </div>
          )}
        </div>
      </aside>

      <header className="topbar">
        <button
          className="icon-button icon-button--gear"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open settings"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a7.9 7.9 0 0 0 .1-6l2-1.2-2-3.4-2.3 1a8.1 8.1 0 0 0-5.2-3l-.3-2.5H9.3L9 2.4a8.1 8.1 0 0 0-5.2 3l-2.3-1-2 3.4 2 1.2a7.9 7.9 0 0 0 0 6l-2 1.2 2 3.4 2.3-1a8.1 8.1 0 0 0 5.2 3l.3 2.5h4.5l.3-2.5a8.1 8.1 0 0 0 5.2-3l2.3 1 2-3.4-2-1.2Z" />
          </svg>
        </button>
        <div className="topbar-title">Oliver's Application Tracker</div>
        <div className="topbar-spacer" />
      </header>

      <main className="main" ref={scrollRef}>
        <div className="content">
          <section
            className="composer"
            style={{
              ['--collapse' as string]: `${composerProgress}`
            }}
            data-collapsed={composerProgress > 0.95}
          >
            <div className="composer-card">
              <div className="composer-input">
                <textarea
                  ref={composerRef}
                  rows={1}
                  placeholder="Paste an email or webpage, or ask the assistant to update your applications..."
                  value={aiInput}
                  onChange={(event) => {
                    setAiInput(event.target.value);
                    resizeComposer();
                  }}
                  onInput={resizeComposer}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <button
                  className="send-button"
                  onClick={handleSend}
                  disabled={aiLoading}
                  aria-label="Send"
                >
                  {aiLoading ? (
                    <span className="spinner" />
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M21.6 12.2 3.7 3.4a.7.7 0 0 0-1 .77l2.5 6.6a.9.9 0 0 0 .7.56l6.7 1.1-6.7 1.1a.9.9 0 0 0-.7.56l-2.5 6.6a.7.7 0 0 0 1 .77l17.9-8.8a.7.7 0 0 0 0-1.23Z" />
                    </svg>
                  )}
                </button>
              </div>

              {aiNotice && (
                <div className="ai-notice" title={aiNotice}>
                  {aiNotice}
                </div>
              )}
            </div>
          </section>

          <section className="list-section">
            <div className="list-header">
              <div>
                <h2>Applications</h2>
                <p className="muted">{jobCountLabel}</p>
              </div>
            </div>

            <div className="filter-row">
              <div className="filter-chips">
                <button
                  className={`filter-chip ${
                    statusFilter === 'all' ? 'active' : ''
                  }`}
                  onClick={() => setStatusFilter('all')}
                >
                  <span className="status-dot" />
                  All
                  <span className="chip-count">{statusCounts.all}</span>
                </button>
                {statusOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`filter-chip ${
                      statusFilter === option.value ? 'active' : ''
                    }`}
                    data-status={option.value}
                    onClick={() => setStatusFilter(option.value)}
                  >
                    <span className="status-dot" />
                    {option.label}
                    <span className="chip-count">{statusCounts[option.value]}</span>
                  </button>
                ))}
              </div>
              <div className="filter-actions">
                <label className="search-input">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm8.7 13.3-3.4-3.4a1 1 0 0 0-1.4 1.4l3.4 3.4a1 1 0 1 0 1.4-1.4Z" />
                  </svg>
                  <input
                    placeholder="Search company or role..."
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </label>
                <div className="sort-select">
                  <span>Sort</span>
                  <select
                    value={sortMode}
                    onChange={(event) =>
                      setSortMode(event.target.value as SortMode)
                    }
                  >
                    {sortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="quick-add">
              <input
                placeholder="Company"
                value={formCompany}
                onChange={(event) => setFormCompany(event.target.value)}
              />
              <input
                placeholder="Role"
                value={formRole}
                onChange={(event) => setFormRole(event.target.value)}
              />
              <div className="status-select" data-status={formStatus}>
                <span className="status-dot" />
                <span className="status-label">{getStatusLabel(formStatus)}</span>
                <select
                  value={formStatus}
                  onChange={(event) =>
                    setFormStatus(event.target.value as JobStatus)
                  }
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="date"
                value={formDate}
                onChange={(event) => setFormDate(event.target.value)}
              />
              <button className="primary" onClick={handleAddJob}>
                Add
              </button>
            </div>

            <div className="job-list">
              {sortedJobs.map((job) => {
                const isOpen = expandedId === job.id;
                const timelineItems = (job.timeline ?? [])
                  .slice()
                  .sort(
                    (a, b) =>
                      new Date(b.createdAt).getTime() -
                      new Date(a.createdAt).getTime()
                  )
                  .slice(0, 8);
                const latestNote =
                  job.notes && job.notes.length > 0
                    ? job.notes[job.notes.length - 1]
                    : '';

                return (
                  <div
                    key={job.id}
                    className="job-card"
                    data-status={job.status}
                    data-open={isOpen ? 'true' : 'false'}
                  >
                    <div className="job-main">
                      <div>
                        <div className="job-company">{job.company}</div>
                        <div className="job-role">{job.role}</div>
                      </div>
                      <div className="job-controls">
                        <div className="status-select" data-status={job.status}>
                          <span className="status-dot" />
                          <span className="status-label">
                            {getStatusLabel(job.status)}
                          </span>
                          <select
                            value={job.status}
                            onChange={(event) =>
                              setStatus(job.id, event.target.value as JobStatus)
                            }
                          >
                            {statusOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <input
                          type="date"
                          value={job.appliedDate ?? ''}
                          onChange={(event) =>
                            updateJob(job.id, { appliedDate: event.target.value })
                          }
                        />
                        <button
                          className="ghost"
                          onClick={() =>
                            setExpandedId(expandedId === job.id ? null : job.id)
                          }
                        >
                          {expandedId === job.id ? 'Hide' : 'Details'}
                        </button>
                      </div>
                    </div>

                    <div className="job-details">
                      <div className="detail-toolbar">
                        <p className="muted">
                          Last updated{' '}
                          {formatTimeline(job.updatedAt ?? job.createdAt)}
                        </p>
                        <button
                          className="icon-button icon-button--danger"
                          onClick={() => handleDeleteJob(job.id)}
                          aria-label="Delete application"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Zm-1 12h12a2 2 0 0 0 2-2V7H4v12a2 2 0 0 0 2 2Z" />
                          </svg>
                        </button>
                      </div>
                      <div className="job-details-grid">
                        <div className="details-left">
                          <div className="note-panel">
                            <div className="note-header">
                              <h3>Note</h3>
                              {latestNote ? (
                                <span className="muted">Tap to edit</span>
                              ) : (
                                <span className="muted">Add a note</span>
                              )}
                            </div>
                            {noteEditingId === job.id ? (
                              <>
                                <textarea
                                  rows={4}
                                  value={noteDrafts[job.id] ?? ''}
                                  placeholder="Write a short note..."
                                  onChange={(event) =>
                                    setNoteDrafts((prev) => ({
                                      ...prev,
                                      [job.id]: event.target.value
                                    }))
                                  }
                                />
                                <div className="note-actions">
                                  <button
                                    className="primary"
                                    onClick={async () => {
                                      const value =
                                        noteDrafts[job.id]?.trim() ?? '';
                                      await setNote(job.id, value || null);
                                      setNoteEditingId(null);
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="ghost"
                                    onClick={() => setNoteEditingId(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button
                                className={`note-display ${
                                  latestNote ? '' : 'empty'
                                }`}
                                onClick={() => {
                                  setNoteEditingId(job.id);
                                  setNoteDrafts((prev) => ({
                                    ...prev,
                                    [job.id]: latestNote
                                  }));
                                }}
                              >
                                {latestNote
                                  ? latestNote
                                  : 'Click to add a note...'}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="details-right">
                          <h3>Timeline</h3>
                          {timelineItems.length === 0 && (
                            <p className="muted">No activity yet.</p>
                          )}
                          <div className="timeline">
                            {timelineItems.map((item) => (
                              <div key={item.id} className="timeline-item">
                                <div className="timeline-dot" />
                                <div>
                                  <p className="timeline-label">{item.label}</p>
                                  <p className="timeline-time">
                                    {formatTimeline(item.createdAt)}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {sortedJobs.length === 0 && (
                <div className="empty">
                  {jobs.length === 0
                    ? 'No applications yet.'
                    : 'No applications in this filter.'}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
