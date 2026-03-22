import { useState, useEffect } from 'react'
import DataTable from '../components/DataTable'
import { useToast } from '../components/Toast'
import api from '../utils/api'

export default function Users() {
    const toast = useToast()
    const [users, setUsers] = useState([])
    const [loading, setLoading] = useState(true)
    const [form, setForm] = useState({ username: '', password: '', role: 'Operator' })
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        fetchUsers()
    }, [])

    const fetchUsers = async () => {
        try {
            const { data } = await api.get('/api/users')
            setUsers(data)
        } catch (error) {
            toast.error('Failed to load users')
        } finally {
            setLoading(false)
        }
    }

    const handleChange = (e) => {
        const { name, value } = e.target
        setForm(prev => ({ ...prev, [name]: value }))
    }

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!form.username.trim() || !form.password.trim()) {
            toast.error('Username and password are required')
            return
        }

        setSubmitting(true)
        try {
            const { data } = await api.post('/api/users', form)
            setUsers(prev => [data, ...prev])
            toast.success('User created')
            setForm({ username: '', password: '', role: 'Operator' })
        } catch (error) {
            toast.error(error.response?.data?.error || 'Failed to create user')
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async (id) => {
        try {
            await api.delete(`/api/users/${id}`)
            setUsers(prev => prev.filter(u => u.id !== id))
            toast.success('User deleted')
        } catch (error) {
            toast.error('Failed to delete user')
        }
    }

    const columns = [
        { key: 'username', label: 'Username' },
        { 
            key: 'role', label: 'Role', render: (v) => (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${v === 'Admin' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'}`}>
                    {v}
                </span>
            ) 
        },
        { key: 'created_at', label: 'Created At', render: (v) => new Date(v).toLocaleDateString() }
    ]

    const inputClass = "w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2 text-sm transition-colors focus:border-accent-gold"

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary">User Management</h2>
                <p className="text-sm text-text-secondary mt-1">Manage system access</p>
            </div>

            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg p-6">
                <h3 className="text-sm font-medium text-text-secondary/70 uppercase mb-4">Add New User</h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Username</label>
                        <input type="text" name="username" value={form.username} onChange={handleChange} className={inputClass} required />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Password</label>
                        <input type="password" name="password" value={form.password} onChange={handleChange} className={inputClass} required />
                    </div>
                    <div className="space-y-2">
                        <label className="text-xs text-text-secondary uppercase">Role</label>
                        <select name="role" value={form.role} onChange={handleChange} className={inputClass}>
                            <option value="Admin">Admin</option>
                            <option value="Operator">Operator</option>
                        </select>
                    </div>
                    <button type="submit" disabled={submitting} className="bg-accent-gold text-black font-semibold py-2 px-4 rounded-lg h-[42px] hover:bg-accent-gold-hover transition-colors">
                        {submitting ? 'Adding...' : 'Add User'}
                    </button>
                </form>
            </div>

            {loading ? (
                <div className="text-center py-8 text-text-secondary">Loading users...</div>
            ) : (
                <DataTable columns={columns} data={users} onDelete={handleDelete} emptyMessage="No users found." />
            )}
        </div>
    )
}
