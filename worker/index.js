// Edge gate for vp.avlokai.com: only Windows desktop browsers get the app.
// Everything else (phones, tablets, macOS, Linux, ChromeOS) gets a 403 page.
// This is a deterrent, not authentication — the API still enforces login.

const BLOCKED_UA =
  /Android|iPhone|iPad|iPod|Mobile|Mobi|Windows Phone|IEMobile|BlackBerry|BB10|Opera Mini|Kindle|Silk|webOS|Tablet|CrOS|Xbox/i

// Path the in-page check redirects to when the browser's own JS APIs
// contradict the headers it sent (e.g. a spoofed User-Agent).
const DENIED_PATH = '/__denied'

export function isAllowed(headers) {
  const ua = headers.get('user-agent') || ''
  const platform = (headers.get('sec-ch-ua-platform') || '').replace(/"/g, '').trim()

  if (headers.get('sec-ch-ua-mobile') === '?1') return false
  if (platform && platform !== 'Windows') return false
  if (!/Windows NT \d/.test(ua)) return false
  if (BLOCKED_UA.test(ua)) return false
  return true
}

function describeDevice(ua) {
  if (/iPhone/i.test(ua)) return 'Apple iPhone'
  if (/iPad/i.test(ua)) return 'Apple iPad'
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Apple Mac'
  if (/CrOS/i.test(ua)) return 'Chromebook'
  if (/Linux/i.test(ua)) return 'Linux device'
  return 'Unrecognised device'
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function deniedPage(request) {
  const ua = request.headers.get('user-agent') || 'unknown'
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const ray = request.headers.get('cf-ray') || 'unknown'
  const city = request.cf?.city ? `${request.cf.city}, ${request.cf.country}` : request.cf?.country || 'unknown'
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST'

  // Persisted by Workers observability logs, so the page's "recorded" claim is true.
  console.log(JSON.stringify({ event: 'device_blocked', ip, ray, city, ua, path: new URL(request.url).pathname }))

  const row = (k, v) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Access Denied</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
    background:#0a0000;color:#f3d6d6;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
    background-image:repeating-linear-gradient(0deg,rgba(255,0,0,.04) 0 1px,transparent 1px 3px)}
  .box{width:100%;max-width:560px;border:2px solid #d10000;background:#140000;
    box-shadow:0 0 40px rgba(209,0,0,.35);animation:pulse 2s ease-in-out infinite}
  @keyframes pulse{50%{box-shadow:0 0 70px rgba(209,0,0,.6)}}
  @media (prefers-reduced-motion:reduce){.box{animation:none}}
  .bar{background:#d10000;color:#fff;padding:10px 16px;font-weight:700;letter-spacing:.18em;font-size:13px}
  .body{padding:24px 20px}
  .icon{font-size:56px;line-height:1;text-align:center;margin-bottom:12px}
  h1{color:#ff2b2b;font-size:26px;letter-spacing:.08em;text-align:center;margin-bottom:6px}
  .sub{text-align:center;color:#ff8a8a;font-size:13px;letter-spacing:.12em;margin-bottom:20px}
  p{font-size:14px;line-height:1.6;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:12px;margin:18px 0}
  th,td{text-align:left;padding:7px 8px;border-top:1px solid #3a0000;vertical-align:top}
  th{color:#ff6b6b;width:34%;font-weight:600;white-space:nowrap}
  td{word-break:break-all;color:#ffd0d0}
  .foot{font-size:12px;color:#b07070;border-top:1px dashed #5a0000;padding-top:14px}
</style>
</head>
<body>
<div class="box" role="alert">
  <div class="bar">&#9888; SECURITY NOTICE &mdash; ERROR 403</div>
  <div class="body">
    <div class="icon" aria-hidden="true">&#9940;</div>
    <h1>ACCESS DENIED</h1>
    <div class="sub">UNAUTHORISED DEVICE DETECTED</div>
    <p>This is a restricted internal system of <strong>Venkateswara Polymers</strong>.
       Access is permitted <strong>only from authorised Windows workstations</strong>.
       Mobile phones, tablets and other devices are blocked.</p>
    <p>This access attempt has been <strong>logged</strong> and is visible to the system administrator.</p>
    <table>
      ${row('IP address', ip)}
      ${row('Location', city)}
      ${row('Device', describeDevice(ua))}
      ${row('Time', when)}
      ${row('Incident ID', ray)}
    </table>
    <div class="foot">If you are an employee, use your assigned office computer. Do not retry from this device.</div>
  </div>
</div>
</body>
</html>`

  return new Response(html, {
    status: 403,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      vary: 'User-Agent, Sec-CH-UA-Platform, Sec-CH-UA-Mobile',
    },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === DENIED_PATH || !isAllowed(request.headers)) {
      return deniedPage(request)
    }

    const res = await env.ASSETS.fetch(request)
    const out = new Response(res.body, res)
    out.headers.set('accept-ch', 'Sec-CH-UA-Platform, Sec-CH-UA-Mobile')
    out.headers.append('vary', 'User-Agent, Sec-CH-UA-Platform, Sec-CH-UA-Mobile')
    return out
  },
}
