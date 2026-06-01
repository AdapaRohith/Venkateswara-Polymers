import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Edit3, ExternalLink, FileVideo, Image, RefreshCw, Trash2, X } from 'lucide-react'
import api, { BASE_URL } from '../utils/api'
import { useToast } from '../components/Toast'

const AUTH_TOKEN_KEY = 'token'

function formatDate(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatSize(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`
  return `${(value / (1024 * 1024)).toFixed(1)}MB`
}

function getErrorMessage(error, fallback) {
  return error?.response?.data?.detail || error?.response?.data?.error || fallback
}

export default function IssueReports() {
  const toast = useToast()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [openingId, setOpeningId] = useState(null)
  const [actionId, setActionId] = useState(null)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [preview, setPreview] = useState(null)
  const [editForm, setEditForm] = useState({ title: '', description: '', status: 'open' })

  const loadReports = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/issue-reports')
      setReports(Array.isArray(data) ? data : [])
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load issue reports'))
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadReports()
  }, [loadReports])

  const openAttachment = async (reportId, attachment) => {
    const key = `${reportId}-${attachment.id}`
    setOpeningId(key)
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY)
      const response = await fetch(`${BASE_URL}${attachment.url}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Failed to open attachment')

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      setPreview({
        url: objectUrl,
        name: attachment.original_filename,
        contentType: attachment.content_type,
      })
    } catch {
      toast.error('Failed to open attachment')
    } finally {
      setOpeningId(null)
    }
  }

  const markFixed = async (report) => {
    setActionId(`fixed-${report.id}`)
    try {
      const nextStatus = report.status === 'fixed' ? 'open' : 'fixed'
      await api.put(`/issue-reports/${report.id}`, { status: nextStatus })
      setReports(prev => prev.map(item => item.id === report.id ? { ...item, status: nextStatus } : item))
      toast.success(nextStatus === 'fixed' ? 'Marked as fixed' : 'Reopened issue')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update issue'))
    } finally {
      setActionId(null)
    }
  }

  const deleteReport = async (report) => {
    setActionId(`delete-${report.id}`)
    try {
      await api.delete(`/issue-reports/${report.id}`)
      setReports(prev => prev.filter(item => item.id !== report.id))
      setDeleting(null)
      toast.success('Issue report deleted')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete issue'))
    } finally {
      setActionId(null)
    }
  }

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  const startEdit = (report) => {
    setEditing(report)
    setEditForm({
      title: report.title || '',
      description: report.description || '',
      status: report.status || 'open',
    })
  }

  const saveEdit = async (event) => {
    event.preventDefault()
    if (!editForm.title.trim()) {
      toast.error('Title is required')
      return
    }

    setActionId(`edit-${editing.id}`)
    try {
      const payload = {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        status: editForm.status,
      }
      const { data } = await api.put(`/issue-reports/${editing.id}`, payload)
      setReports(prev => prev.map(item => item.id === editing.id ? { ...item, ...data } : item))
      setEditing(null)
      toast.success('Issue report updated')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update issue'))
    } finally {
      setActionId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary">Issue Reports</h2>
          <p className="mt-1 text-sm text-text-secondary">Review submitted issues and attached media.</p>
        </div>
        <button
          type="button"
          onClick={loadReports}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-default px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-accent-gold/50 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-default bg-bg-card shadow-lg">
        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-text-secondary">Loading issue reports...</div>
        ) : reports.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-text-secondary">No issue reports yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-collapse text-sm">
              <thead className="border-b border-border-default bg-bg-input/40 text-xs uppercase text-text-secondary">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Issue</th>
                  <th className="px-4 py-3 text-left font-semibold">Reporter</th>
                  <th className="px-4 py-3 text-left font-semibold">Date</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Files</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {reports.map(report => (
                  <tr key={report.id} className="transition-colors hover:bg-bg-row-hover">
                    <td className="max-w-[360px] px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-text-primary">{report.title}</p>
                          <p className="truncate text-xs text-text-secondary">{report.description || report.page_url || 'No details'}</p>
                        </div>
                        {report.page_url ? (
                          <a
                            href={report.page_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 rounded-md p-1.5 text-text-secondary hover:bg-bg-input hover:text-text-primary"
                            aria-label="Open reported page"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-text-secondary">
                      {report.reporter_name || report.reporter_email || 'Unknown user'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-text-secondary">{formatDate(report.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold capitalize ${
                        report.status === 'fixed'
                          ? 'border-blue-500/25 bg-blue-500/10 text-blue-400'
                          : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                      }`}>
                        {report.status || 'open'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-[260px] items-center gap-1 overflow-x-auto">
                        {(report.attachments || []).length === 0 ? (
                          <span className="text-xs text-text-secondary">None</span>
                        ) : report.attachments.map(attachment => {
                          const isVideo = String(attachment.content_type || '').startsWith('video/')
                          const key = `${report.id}-${attachment.id}`
                          return (
                            <button
                              key={attachment.id}
                              type="button"
                              onClick={() => openAttachment(report.id, attachment)}
                              disabled={openingId === key}
                              title={`${attachment.original_filename} (${formatSize(attachment.size_bytes)})`}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-default text-text-secondary transition-colors hover:border-accent-gold/50 hover:bg-accent-gold-muted hover:text-accent-gold disabled:cursor-wait disabled:opacity-60"
                            >
                              {isVideo ? <FileVideo className="h-4 w-4" /> : <Image className="h-4 w-4" />}
                            </button>
                          )
                        })}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => markFixed(report)}
                          disabled={actionId === `fixed-${report.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-border-default px-2 text-xs font-semibold text-text-secondary hover:border-blue-500/40 hover:text-blue-400 disabled:cursor-wait disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {report.status === 'fixed' ? 'Open' : 'Fixed'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(report)}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-border-default px-2 text-xs font-semibold text-text-secondary hover:border-accent-gold/40 hover:text-accent-gold"
                        >
                          <Edit3 className="h-4 w-4" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(report)}
                          disabled={actionId === `delete-${report.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-border-default px-2 text-xs font-semibold text-text-secondary hover:border-red-500/40 hover:text-red-400 disabled:cursor-wait disabled:opacity-60"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing ? (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 px-3 py-4 backdrop-blur-sm sm:items-center">
          <form onSubmit={saveEdit} className="w-full max-w-lg rounded-lg border border-border-default bg-bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
              <h3 className="text-base font-semibold text-text-primary">Edit Issue Report</h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md p-2 text-text-secondary transition-colors hover:bg-bg-row-hover hover:text-text-primary"
                aria-label="Close edit issue"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-secondary">Title</label>
                <input
                  value={editForm.title}
                  onChange={event => setEditForm(prev => ({ ...prev, title: event.target.value }))}
                  className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent-gold"
                  maxLength={255}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-secondary">Details</label>
                <textarea
                  value={editForm.description}
                  onChange={event => setEditForm(prev => ({ ...prev, description: event.target.value }))}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent-gold"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-text-secondary">Status</label>
                <select
                  value={editForm.status}
                  onChange={event => setEditForm(prev => ({ ...prev, status: event.target.value }))}
                  className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent-gold"
                >
                  <option value="open">Open</option>
                  <option value="fixed">Fixed</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border-default px-5 py-4">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-border-default px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionId === `edit-${editing.id}`}
                className="rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover disabled:cursor-wait disabled:opacity-70"
              >
                {actionId === `edit-${editing.id}` ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleting ? (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 px-3 py-4 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md rounded-lg border border-border-default bg-bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
              <h3 className="text-base font-semibold text-text-primary">Delete Issue Report</h3>
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="rounded-md p-2 text-text-secondary transition-colors hover:bg-bg-row-hover hover:text-text-primary"
                aria-label="Close delete confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-5">
              <p className="text-sm text-text-secondary">
                Delete <span className="font-semibold text-text-primary">{deleting.title}</span> and its attachments?
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border-default px-5 py-4">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                disabled={actionId === `delete-${deleting.id}`}
                className="rounded-lg border border-border-default px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteReport(deleting)}
                disabled={actionId === `delete-${deleting.id}`}
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-wait disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                {actionId === `delete-${deleting.id}` ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 px-3 py-4 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border-default bg-bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
              <p className="truncate text-sm font-semibold text-text-primary">{preview.name}</p>
              <button
                type="button"
                onClick={closePreview}
                className="rounded-md p-2 text-text-secondary transition-colors hover:bg-bg-row-hover hover:text-text-primary"
                aria-label="Close attachment preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-3">
              {String(preview.contentType || '').startsWith('video/') ? (
                <video src={preview.url} controls className="max-h-[78vh] max-w-full" />
              ) : (
                <img src={preview.url} alt={preview.name} className="max-h-[78vh] max-w-full object-contain" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
