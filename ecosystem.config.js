module.exports = {
  apps: [{
    name: 'vp-api',
    script: 'uvicorn',
    args: 'server:app --host 0.0.0.0 --port 3000 --loop uvloop --workers 1',
    interpreter: 'none',
    cwd: '/root/Venkateswara-Polymers',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    // The plant runs on IST and the columns are timestamps without a zone, so
    // the process clock has to match the one the floor reads.
    env: {
      TZ: 'Asia/Kolkata',
      APP_TIMEZONE: 'Asia/Kolkata',
    },
  }]
}
