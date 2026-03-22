# Demo VIP Anti

Frontend: React + Vite  
Backend: Node.js + Express + MongoDB (Mongoose)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create your env file:

```bash
copy .env.example .env
```

3. Set `MONGODB_URI` in `.env`.

Example format:

```env
MONGODB_URI=mongodb+srv://<username>:<url-encoded-password>@cluster0.ahfl611.mongodb.net/demo-vip-anti?retryWrites=true&w=majority&appName=Cluster0
PORT=5000
```

Important: if your password contains special characters like `@`, `:`, `/`, or `#`, URL-encode it.

## Run

Start backend:

```bash
npm run server
```

In another terminal, start frontend:

```bash
npm run dev
```

Frontend calls `/api/*`, proxied by Vite to `http://localhost:5000`.

## API

- `GET /api/health` → backend status
- `GET /api/state` → full app state
- `PUT /api/state` → save full app state
