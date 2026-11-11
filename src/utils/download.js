import { BASE_URL } from './api'

/** Download an authenticated file (the Excel reports) and save it with the server's name. */
export async function downloadFile(path, fallbackName = 'report.xlsx') {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
  })
  if (!res.ok) {
    let detail = `Download failed (${res.status})`
    try { detail = (await res.json()).detail || detail } catch { /* not JSON */ }
    throw new Error(detail)
  }
  const blob = await res.blob()
  const match = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = match ? match[1] : fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
