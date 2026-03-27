import { useState, useEffect } from 'react'
import DataTable from '../components/DataTable'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
import api, { fetchPendingUsers as fetchPendingUsersRequest } from '../utils/api'
import ChangePasswordForm from '../components/ChangePasswordForm'

export default function Users() {
    const toast = useToast()
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [form, setForm] = usePersistentState('vp_users_form', { email: '', password: '', name: '', role: 'worker' })
    const [submitting, setSubmitting] = useState(false)
    const [pendingUsers, setPendingUsers] = useState([])
    const [pendingLoading, setPendingLoading] = useState(true)
    const [pendingError, setPendingError] = useState('')
    const [pendingAction, setPendingAction] = useState(null)

    useEffect(() => {
        fetchUsers()
        loadPendingUsers()
    }, [])

    const fetchUsers = async () => {
        try {
            const { data } = await api.get('/users')
            setUsers(data)
        } catch (error) {
            toast.error('Failed to load users')
        } finally {
            setLoading(false)
        }
    }

    const loadPendingUsers = async () => {
        setPendingLoading(true)
        setPendingError('')

        try {
            const { data } = await fetchPendingUsersRequest()
            setPendingUsers(Array.isArray(data) ? data : [])
        } catch (error) {
            const message = error.response?.data?.error || 'Failed to load pending users'
            setPendingError(message)
            setPendingUsers([])
            toast.error(message)
        } finally {
            setPendingLoading(false)
        }
    }

    const handleChange = (e) => {
        const { name, value } = e.target
        setForm(prev => ({ ...prev, [name]: value }))
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!form.email.trim() || !form.password.trim() || !form.name.trim()) {
            toast.error('Name, email, and password are required')
            return
        }

        setSubmitting(true)
        try {
            const { data } = await api.post('/users', form)
            setUsers(prev => [data, ...prev])
            toast.success('User created')
            setForm({ email: '', password: '', name: '', role: 'worker' })
        } catch (error) {
            toast.error(error.response?.data?.error || 'Failed to create user')
        } finally {
            setSubmitting(false)
        }
    }

    const handlePendingAction = async (userId, action) => {
        const actionKey = `${action}-${userId}`
        setPendingAction(actionKey)

        try {
            await api.post(`/admin/${action}-user`, { user_id: userId })
            toast.success(action === 'approve' ? 'User approved' : 'User rejected')
            await Promise.all([loadPendingUsers(), fetchUsers()])
        } catch (error) {
            toast.error(error.response?.data?.error || `Failed to ${action} user`)
        } finally {
            setPendingAction(null)
        }
    }

    const columns = [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { 
            key: 'role', label: 'Role', render: (v) => (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${String(v).toLowerCase() === 'owner' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'}`}>
                    {v}
                </span>
            ) 
        },
        { key: 'created_at', label: 'Created At', render: (v) => v ? new Date(v).toLocaleDateString() : '-' }
    ]

    const inputClass = "w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2 text-sm transition-colors focus:border-accent-gold"

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary">User Management</h2>
                <p className="text-sm text-text-secondary mt-1">Manage system access</p>
            </div>

            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg p-6 space-y-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h3 className="text-sm font-medium text-text-secondary/70 uppercase tracking-wide">Pending Approvals</h3>
                        <p className="text-sm text-text-secondary">Review new worker registration requests.</p>
                    </div>
                    <button
                        type="button"
                        onClick={loadPendingUsers}
                        className="inline-flex items-center gap-2 rounded-lg border border-border-default px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent-gold/50 transition-colors"
                        disabled={pendingLoading}
                    >
                        {pendingLoading ? 'Refreshing…' : 'Refresh'}
                    </button>
                </div>

                {pendingLoading ? (
                    <div className="rounded-lg border border-border-default bg-bg-input/40 px-4 py-3 text-sm text-text-secondary">Loading pending users…</div>
                ) : pendingError ? (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-3 text-sm text-red-300">{pendingError}</div>
                ) : pendingUsers.length === 0 ? (
                    <div className="rounded-lg border border-border-default bg-bg-input/40 px-4 py-3 text-sm text-text-secondary">No pending approvals right now.</div>
                ) : (
                    <ul className="space-y-3">
                        {pendingUsers.map((user) => {
                            const approveKey = `approve-${user.id}`
                            const rejectKey = `reject-${user.id}`
                            const isApproving = pendingAction === approveKey
                            const isRejecting = pendingAction === rejectKey

                            return (
                                <li
                                    key={user.id}
                                    className="flex flex-col gap-3 rounded-lg border border-border-default bg-bg-input/30 px-4 py-3 md:flex-row md:items-center md:justify-between"
                                >
                                    <div>
                                        <p className="text-sm font-semibold text-text-primary">{user.name}</p>
                                        <p className="text-xs text-text-secondary">{user.email}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handlePendingAction(user.id, 'approve')}
                                            disabled={isApproving || isRejecting}
                                            className="inline-flex items-center rounded-lg bg-accent-gold px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-accent-gold-hover disabled:cursor-not-allowed disabled:opacity-70"
                                        >
                                            {isApproving ? 'Approving…' : 'Approve'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handlePendingAction(user.id, 'reject')}
                                            disabled={isApproving || isRejecting}
                                            className="inline-flex items-center rounded-lg border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {isRejecting ? 'Rejecting…' : 'Reject'}
                                        </button>
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>

            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg p-6">
                <h3 className="text-sm font-medium text-text-secondary/70 uppercase mb-4">Add New User</h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Name</label>
                        <input type="text" name="name" value={form.name} onChange={handleChange} className={inputClass} required />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Email</label>
                        <input type="email" name="email" value={form.email} onChange={handleChange} className={inputClass} required />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Password</label>
                        <input type="password" name="password" value={form.password} onChange={handleChange} className={inputClass} required />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Role</label>
                        <select name="role" value={form.role} onChange={handleChange} className={inputClass}>
                            <option value="owner">Owner</option>
                            <option value="worker">Worker</option>
                        </select>
                    </div>
                    <button type="submit" disabled={submitting} className="bg-accent-gold text-black font-semibold py-2 px-4 rounded-lg h-[42px] hover:bg-accent-gold-hover transition-colors">
                        {submitting ? 'Adding...' : 'Add User'}
                    </button>
                </form>
                <p className="mt-4 text-[11px] text-text-secondary/50">
                    The live API currently supports creating and listing users only. Delete is not available yet.
                </p>
            </div>

            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg p-6">
                <h3 className="text-sm font-medium text-text-secondary/70 uppercase mb-4">Change Password</h3>
                <ChangePasswordForm />
            </div>

            {loading ? (
                <div className="text-center py-8 text-text-secondary">Loading users...</div>
            ) : (
                <DataTable columns={columns} data={users} emptyMessage="No users found." />
            )}
        </div>
    )
}
