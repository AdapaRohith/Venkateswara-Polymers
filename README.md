# Demo VIP Anti

Demo VIP Anti is a full-stack web application built with React and Vite on the frontend and Node.js, Express, and MongoDB on the backend.

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MongoDB (Mongoose)

## Prerequisites

- Node.js 18+ (recommended)
- npm 9+
- MongoDB connection string

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create an environment file:

```bash
copy .env.example .env
```

3. Update `.env` with your MongoDB URI:

```env
MONGODB_URI=mongodb+srv://<username>:<url-encoded-password>@cluster0.ahfl611.mongodb.net/demo-vip-anti?retryWrites=true&w=majority&appName=Cluster0
PORT=5000
```

If your password has special characters like `@`, `:`, `/`, or `#`, URL-encode it.

## Run the App

Start backend server:

```bash
npm run server
```

Start frontend (new terminal):

```bash
npm run dev
```

The frontend proxies `/api/*` requests to `http://localhost:5000`.

## API Endpoints

- `GET /api/health` - Backend health status
- `GET /api/state` - Fetch full app state
- `PUT /api/state` - Save full app state

## Branch Workflow for Team Updates

If someone cannot see your latest changes after pulling `main`, share updates from a feature branch:

```bash
git checkout -b update-readme
git add README.md
git commit -m "docs: refresh README"
git push -u origin update-readme
```

Then ask your teammate to run:

```bash
git fetch origin
git checkout update-readme
git pull
```
