import { useMemo, useRef, useState } from 'react'
import { AlertCircle, Paperclip, Send, X } from 'lucide-react'
import api from '../utils/api'
import { useToast } from './Toast'

const MAX_FILES = 5
const MAX_FILE_MB = 25
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime'

function getErrorMessage(error) {
  return error?.response?.data?.detail || error?.response?.data?.error || 'Failed to send issue report'
}

export default function IssueReportDialog({ open, onClose }) {
  const toast = useToast()
  const fileInputRef = useRef(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState([])
  const [submitting, setSubmitting] = useState(false)

  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  )

  if (!open) return null

  const reset = () => {
    setTitle('')
    setDescription('')
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const handleFiles = (event) => {
    const selected = Array.from(event.target.files || [])
    const next = [...files, ...selected].slice(0, MAX_FILES)
    const oversized = next.find(file => file.size > MAX_FILE_MB * 1024 * 1024)

    if (selected.length + files.length > MAX_FILES) {
      toast.warning(`Only ${MAX_FILES} attachments can be added`)
    }
    if (oversized) {
      toast.error(`Each attachment must be ${MAX_FILE_MB}MB or less`)
      event.target.value = ''
      return
    }

    setFiles(next)
    event.target.value = ''
  }

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      toast.error('Title is required')
      return
    }

    const formData = new FormData()
    formData.append('title', cleanTitle)
    formData.append('description', description.trim())
    formData.append('page_url', window.location.href)
    formData.append('app_version', import.meta.env?.VITE_APP_VERSION || '')
    files.forEach(file => formData.append('files', file))

    setSubmitting(true)
    try {
      await api.post('/issue-reports', formData)
      toast.success('Issue report sent')
      reset()
      onClose()
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 px-3 py-4 backdrop-blur-sm sm:items-center">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg border border-border-default bg-bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-gold-muted text-accent-gold">
              <AlertCircle className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-text-primary">Report Issue</h2>
              <p className="text-xs text-text-secondary">Attach screenshots or videos</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-2 text-text-secondary transition-colors hover:bg-bg-row-hover hover:text-text-primary"
            aria-label="Close report issue"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase text-text-secondary">Title</label>
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent-gold"
              maxLength={255}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase text-text-secondary">Details</label>
            <textarea
              value={description}
              onChange={event => setDescription(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent-gold"
            />
          </div>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="text-xs font-semibold uppercase text-text-secondary">Attachments</label>
              <span className="text-xs text-text-secondary">
                {files.length}/{MAX_FILES} files · {(totalSize / (1024 * 1024)).toFixed(1)}MB
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              onChange={handleFiles}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-default bg-bg-input/50 px-4 py-3 text-sm font-medium text-text-secondary transition-colors hover:border-accent-gold/60 hover:text-text-primary"
            >
              <Paperclip className="h-4 w-4" />
              Add image or video
            </button>

            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-bg-input/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">{file.name}</p>
                      <p className="text-xs text-text-secondary">{(file.size / (1024 * 1024)).toFixed(1)}MB</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="rounded-md p-1.5 text-text-secondary hover:bg-bg-row-hover hover:text-red-400"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-default px-5 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="rounded-lg border border-border-default px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Send className="h-4 w-4" />
            {submitting ? 'Sending...' : 'Send Report'}
          </button>
        </div>
      </form>
    </div>
  )
}
