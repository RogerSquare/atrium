const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Atrium API',
      version: '1.0.0',
      description: 'AI and Human Collaborative Kanban Board — REST API reference.\n\nAll endpoints accept and return JSON. No authentication middleware is enforced yet (trust-client model).',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Local development' },
    ],
    tags: [
      { name: 'Tasks', description: 'Task CRUD, history, and restore' },
      { name: 'Projects', description: 'Project management and descriptions' },
      { name: 'Auth', description: 'User registration, login, and management' },
      { name: 'Agents', description: 'AI agent lifecycle (start/stop/active)' },
      { name: 'Chat', description: 'Team chat messages, online users, GIFs' },
      { name: 'AI', description: 'AI assistant chat with Claude' },
      { name: 'Settings', description: 'System settings, status, export, and maintenance' },
      { name: 'Services', description: 'Service registry, lifecycle, and logs' },
      { name: 'Preview', description: 'Embedded service preview proxy' },
      { name: 'Presence', description: 'Live task viewer presence' },
    ],
    components: {
      schemas: {
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'feat-auth-001' },
            title: { type: 'string', example: 'Implement JWT Login' },
            status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'], example: 'todo' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'], example: 'medium' },
            assignee: { type: 'string', nullable: true, example: 'Claude' },
            type: { type: 'string', enum: ['frontend', 'backend', 'fullstack', 'devops'], example: 'frontend' },
            component: { type: 'string', nullable: true, example: 'Auth Service' },
            tags: { type: 'array', items: { type: 'string' }, example: ['react', 'jwt'] },
            files_affected: { type: 'array', items: { type: 'string' }, example: ['src/components/Login.jsx'] },
            parent_task: { type: 'string', nullable: true, example: null },
            created_at: { type: 'string', format: 'date-time' },
            started_at: { type: 'string', format: 'date-time', nullable: true },
            reviewed_at: { type: 'string', format: 'date-time', nullable: true },
            done_at: { type: 'string', format: 'date-time', nullable: true },
            activity_log: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'string', format: 'date-time' },
                  action: { type: 'string' },
                },
              },
            },
            content: { type: 'string', example: '### Description\nImplement the login form.' },
            project: { type: 'string', example: 'Atrium' },
          },
        },
        HistoryEntry: {
          type: 'object',
          properties: {
            filename: { type: 'string', example: 'feat-auth-001.1711234567890.Claude.md' },
            timestamp: { type: 'string', format: 'date-time' },
            author: { type: 'string', nullable: true },
            size: { type: 'integer' },
          },
        },
        User: {
          type: 'object',
          properties: {
            username: { type: 'string', example: 'RogerSquare' },
            role: { type: 'string', enum: ['admin', 'member'], example: 'admin' },
            can_run_agents: { type: 'boolean', example: true },
            last_login: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        Service: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'atrium-be' },
            name: { type: 'string', example: 'Atrium Backend' },
            group: { type: 'string', example: 'Atrium' },
            port: { type: 'integer', example: 3001 },
            cwd: { type: 'string', example: 'C:\\Projects\\atrium\\backend' },
            startCmd: { type: 'string', example: 'npm run dev' },
            depends_on: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['running', 'stopped'], example: 'running' },
            pid: { type: 'integer', nullable: true },
            startedAt: { type: 'string', format: 'date-time', nullable: true },
            preview: { type: 'boolean' },
            hasLogs: { type: 'boolean' },
          },
        },
        ChatMessage: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            content: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            type: { type: 'string', enum: ['user', 'system'] },
            reactions: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
          },
        },
        Settings: {
          type: 'object',
          properties: {
            workingDirectory: { type: 'string' },
            agents_enabled: { type: 'boolean' },
            default_priority: { type: 'string' },
            default_type: { type: 'string' },
          },
        },
        SystemStatus: {
          type: 'object',
          properties: {
            version: { type: 'string' },
            name: { type: 'string' },
            node_version: { type: 'string' },
            uptime: { type: 'string' },
            uptime_ms: { type: 'number' },
            counts: {
              type: 'object',
              properties: {
                tasks: { type: 'integer' },
                projects: { type: 'integer' },
                users: { type: 'integer' },
                history_backups: { type: 'integer' },
              },
            },
            storage: {
              type: 'object',
              properties: {
                tasks: { type: 'integer' },
                history: { type: 'integer' },
                chat: { type: 'integer' },
                users: { type: 'integer' },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  },
  apis: ['./routes/*.js', './server.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
