# Agent Task Board

A Kanban-style task management system built for autonomous AI developer agents. Tasks are stored as Markdown files with YAML frontmatter, and agents interact with them through a REST API that enforces a strict lifecycle, tracks activity history, and manages timestamps automatically.

## Overview

Agent Task Board provides a visual interface for humans to observe and manage the work of AI coding agents. Each task is a Markdown file in the `backend/tasks/` directory, organized by project. Agents pick up tasks via the API, update their status as they work, and leave structured comments documenting their reasoning and changes. Humans review completed work and control the final approval step.

The system also includes a service registry that tracks related applications (backends, frontends, databases) and allows starting, stopping, and monitoring them directly from the UI. An embedded terminal and preview browser let you inspect running services without leaving the board.

## Architecture

- **Backend**: Express 5, file-based task storage (Markdown + YAML), JWT authentication
- **Frontend**: React 19, Vite, Tailwind CSS, drag-and-drop Kanban board
- **Real-time**: Socket.IO for live updates across connected clients
- **Terminals**: node-pty for embedded terminal sessions via xterm.js
- **Logging**: Pino structured logging

## Features

- **Kanban board**: Drag-and-drop task management across four columns (Todo, In Progress, Review, Done)
- **Markdown task files**: Tasks are human-readable Markdown with YAML frontmatter for metadata
- **Activity logging**: Every status change, assignment, and update is recorded with timestamps
- **Service registry**: Register, start, stop, and restart related services from the UI
- **Embedded terminal**: Full terminal access to running services via xterm.js and node-pty
- **Preview browser**: Iframe-based preview of frontend services running on registered ports
- **Project grouping**: Tasks and services are organized by project
- **Agent lifecycle**: Strict four-status workflow (todo, in_progress, review, done) with automatic timestamp management
- **Task history**: Full revision history stored as timestamped snapshots
- **API documentation**: Swagger UI available at `/api-docs`
- **Auth**: JWT-based authentication with role-based access
- **Rate limiting**: Built-in rate limiting on API endpoints

## Task Lifecycle

Tasks follow a strict four-status workflow:

1. **todo** -- Task is waiting to be picked up
2. **in_progress** -- An agent is actively working on it
3. **review** -- Agent has finished and is requesting human approval
4. **done** -- Human has reviewed and approved the work

Timestamps (`started_at`, `reviewed_at`, `done_at`) are automatically set when tasks transition between statuses. Agents must never skip statuses or use non-standard status values.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Backend Framework | Express 5 |
| Task Storage | Markdown files with YAML frontmatter (gray-matter) |
| Frontend Framework | React 19 |
| Bundler | Vite 8 |
| CSS | Tailwind CSS |
| Drag and Drop | @hello-pangea/dnd |
| Real-time | Socket.IO |
| Terminal | xterm.js + node-pty |
| Auth | JSON Web Tokens (bcryptjs) |
| Logging | Pino |
| Markdown Rendering | react-markdown + remark-gfm |
| Virtualization | @tanstack/react-virtual |
| API Docs | Swagger (swagger-jsdoc + swagger-ui-express) |
| Testing | Vitest, Playwright |
| Linting | ESLint |

## Getting Started

### Prerequisites

- Node.js 18+
- A C++ build toolchain (required by node-pty)

### Installation

```bash
# Clone the repository
git clone https://github.com/RogerSquare/agent-task-board.git
cd agent-task-board

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Configuration

Copy the example configuration files:

```bash
cp backend/settings.example.json backend/settings.json
cp backend/services.example.json backend/services.json
```

Edit `backend/settings.json` to set your working directory, and populate `backend/services.json` with any services you want to manage from the board.

### Running

```bash
# Start the backend (port 3001)
cd backend
npm start

# Start the frontend (separate terminal, port 5173)
cd frontend
npm start
```

Or use the provided start script:

```bash
./start.bat
```

## Project Structure

```
backend/
  server.js              # Express app entry point
  tasks/                 # Task Markdown files, organized by project
    .history/            # Timestamped task revision snapshots
  users/                 # User credential files (gitignored)
  lib/
    authMiddleware.js    # JWT verification
    constants.js         # Shared constants
  routes/                # API route handlers
  settings.json          # Working directory configuration
  services.json          # Service registry

frontend/
  src/
    App.jsx              # Root component
    components/
      Board.jsx          # Kanban board with drag-and-drop
      TaskCard.jsx       # Individual task card
      ServiceManager.jsx # Service start/stop controls
      Terminal.jsx       # Embedded terminal (xterm.js)
      Preview.jsx        # Iframe service preview
```

## API

All task operations go through the REST API:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List all tasks, optionally filtered by project |
| GET | `/api/tasks/:id` | Get a single task |
| POST | `/api/tasks` | Create a new task |
| PUT | `/api/tasks/:id` | Update a task (status, assignee, content, etc.) |
| DELETE | `/api/tasks/:id` | Delete a task |
| POST | `/api/services/:id/start` | Start a registered service |
| POST | `/api/services/:id/stop` | Stop a running service |
| POST | `/api/services/:id/restart` | Restart a service |

Full API documentation is available at `/api-docs` when the backend is running.

## License

MIT
