import { useState } from 'react'
import api from '@/utils/api'
import { useToast } from './Toast'

export default function ChangePasswordForm({ className = '' }) {
  const toast = useToast()
  const [form, setForm] = useState({ old_password: '', new_password: '' })
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState({ type: '', message: '' })

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setFeedback({ type: '', message: '' })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!form.old_password.trim() || !form.new_password.trim()) {
      setFeedback({ type: 'error', message: 'Both fields are required' })
      return
    }

    setLoading(true)

    try {
      const { data } = await api.post('/auth/change-password', {
        old_password: form.old_password,
        new_password: form.new_password,
      })

      const successMessage = data?.message || 'Password updated successfully'
      setFeedback({ type: 'success', message: successMessage })
      toast?.success?.(successMessage)
      setForm({ old_password: '', new_password: '' })
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to change password'
      setFeedback({ type: 'error', message })
      toast?.error?.(message)
    } finally {
      setLoading(false)
    }
  }

  const inputClass = 'w-full bg-bg-input text-text-primary border border-border-default rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/40'

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${className}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="old_password" className="text-xs font-semibold uppercase tracking-wide text-text-secondary/70">Current password</label>
          <input
            id="old_password"
            name="old_password"
            type="password"
            value={form.old_password}
            onChange={handleChange}
            className={inputClass}
            placeholder="Enter current password"
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="new_password" className="text-xs font-semibold uppercase tracking-wide text-text-secondary/70">New password</label>
          <input
            id="new_password"
            name="new_password"
            type="password"
            value={form.new_password}
            onChange={handleChange}
            className={inputClass}
            placeholder="Enter new password"
            required
          />
        </div>
      </div>

      {feedback.message && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border-red-500/40 bg-red-500/15 text-red-300'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? 'Saving...' : 'Update password'}
        </button>
      </div>
    </form>
  )
}