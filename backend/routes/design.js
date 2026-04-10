const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const crypto = require('crypto');
const { SETTINGS_FILE } = require('../lib/constants');
const { getServices } = require('../lib/services');
const { logger } = require('../lib/logger');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'design');
const HISTORY_DIR = path.join(__dirname, '..', 'design-history');
const SESSIONS_DIR = path.join(__dirname, '..', 'design-sessions');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// --- Multer setup ---
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// --- Image Upload ---
router.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image file provided' });
  res.json({
    id: path.basename(req.file.filename, path.extname(req.file.filename)),
    filename: req.file.filename,
    originalName: req.file.originalname,
    url: `/api/design/uploads/${req.file.filename}`,
    size: req.file.size,
  });
});

// Serve uploaded images
router.use('/uploads', express.static(UPLOADS_DIR));

// Delete an uploaded image
router.delete('/upload/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, path.basename(req.params.filename));
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// --- CSS Variable Scanner ---
router.post('/scan-css', (req, res) => {
  try {
    const { serviceId, projectPath } = req.body;
    let scanDir = projectPath;

    if (!scanDir && serviceId) {
      const services = getServices();
      const service = services.find(s => s.id === serviceId);
      if (!service) return res.status(404).json({ error: 'Service not found' });
      scanDir = service.cwd;
    }

    if (!scanDir || !fs.existsSync(scanDir)) {
      return res.status(400).json({ error: 'Project path not found' });
    }

    const srcDir = path.join(scanDir, 'src');
    const targetDir = fs.existsSync(srcDir) ? srcDir : scanDir;

    const variables = [];
    const themes = {};

    const scanFile = (filePath) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(scanDir, filePath);

      // Match CSS variable declarations in various selectors
      const selectorRegex = /([^{}]+)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
      let match;
      while ((match = selectorRegex.exec(content)) !== null) {
        const selector = match[1].trim();
        const block = match[2];

        // Extract --variable: value pairs
        const varRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
        let varMatch;
        while ((varMatch = varRegex.exec(block)) !== null) {
          const name = varMatch[1];
          const value = varMatch[2].trim();

          // Categorize
          let category = 'other';
          if (/color|bg|text|accent|fill|border|separator|shadow/i.test(name)) category = 'colors';
          else if (/font|text-|leading|tracking/i.test(name)) category = 'typography';
          else if (/space|gap|padding|margin|radius/i.test(name)) category = 'spacing';
          else if (/shadow/i.test(name)) category = 'shadows';
          else if (/duration|ease|delay/i.test(name)) category = 'animation';

          // Determine theme
          let theme = 'default';
          if (selector.includes('data-theme="light"') || selector.includes("data-theme='light'")) theme = 'light';
          else if (selector.includes('data-theme="oled"') || selector.includes("data-theme='oled'")) theme = 'oled';
          else if (selector.includes('data-theme="paper"') || selector.includes("data-theme='paper'")) theme = 'paper';
          else if (selector.includes(':root') || selector === ':root') theme = 'default';

          if (!themes[theme]) themes[theme] = {};
          themes[theme][name] = value;

          variables.push({ name, value, category, theme, file: relativePath, selector: selector.slice(0, 60) });
        }
      }
    };

    const scanDirectory = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDirectory(fullPath);
        } else if (/\.(css|scss|less)$/.test(entry.name)) {
          try { scanFile(fullPath); } catch (e) { /* skip unreadable */ }
        }
      }
    };

    scanDirectory(targetDir);

    // Deduplicate by name+theme, keep last occurrence
    const deduped = {};
    variables.forEach(v => { deduped[`${v.theme}:${v.name}`] = v; });

    res.json({
      projectPath: scanDir,
      variableCount: Object.keys(deduped).length,
      variables: Object.values(deduped),
      themes,
    });
  } catch (error) {
    logger.error({ err: error }, 'CSS scan failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- AI Design Chat ---
// Stores { process, sessionKey } so sessions can be cancelled
const activeSessions = new Map();
const MAX_HISTORY = 15;

const loadHistory = (username) => {
  const file = path.join(HISTORY_DIR, `${username}.json`);
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')).slice(-MAX_HISTORY) : []; } catch { return []; }
};

const saveHistory = (username, history) => {
  fs.writeFileSync(path.join(HISTORY_DIR, `${username}.json`), JSON.stringify(history.slice(-MAX_HISTORY), null, 2));
};

// Scan component files for the AI to understand project structure
function scanComponentFiles(projectDir) {
  const components = [];
  const srcDir = path.join(projectDir, 'src');
  const scanDir = fs.existsSync(srcDir) ? srcDir : projectDir;

  const scan = (dir, depth = 0) => {
    if (depth > 4) return; // Don't go too deep
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath, depth + 1);
      } else if (/\.(jsx|tsx|css|scss)$/.test(entry.name)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const relativePath = path.relative(projectDir, fullPath);
          // Only include files under 500 lines to keep prompt manageable
          const lineCount = content.split('\n').length;
          if (lineCount <= 500) {
            components.push({ path: relativePath, content, lineCount });
          } else {
            // For large files, include just the first 80 lines (imports + structure)
            components.push({
              path: relativePath,
              content: content.split('\n').slice(0, 80).join('\n') + '\n// ... (truncated, ' + lineCount + ' total lines)',
              lineCount,
              truncated: true
            });
          }
        } catch (e) { /* skip unreadable */ }
      }
    }
  };
  scan(scanDir);
  return components;
}

const buildDesignPrompt = (message, username, cssVariables, themes, imageDescriptions, history, componentFiles) => {
  const lines = [];
  lines.push('You are a creative AI design partner inside the Opus-Board task management system.');
  lines.push('You help users redesign the look, feel, AND layout of their projects.');
  lines.push('You can modify CSS custom properties for theming AND propose changes to component files (JSX/CSS) for layout/UX restructuring.');
  lines.push('');
  lines.push('## How to Communicate');
  lines.push('- Speak about design in human, visual terms — NOT code jargon');
  lines.push('- Describe colors by feel: "warm amber", "cool slate", "muted sage"');
  lines.push('- For layout changes, describe what moves where: "the sidebar becomes a top nav", "cards get more breathing room"');
  lines.push('- When proposing changes, explain the WHY: "more breathing room makes it feel premium"');
  lines.push('- Ask clarifying questions when the direction is ambiguous');
  lines.push('- Reference uploaded images by number when relevant');
  lines.push('');
  lines.push('## Design Knowledge');
  lines.push('You understand the design languages of popular apps: Linear, Notion, Stripe, Apple, Vercel, Discord, Spotify,');
  lines.push('GitHub, Figma, Raycast, Arc, Airbnb, Shopify, Medium, and more.');
  lines.push('You understand CSS Grid, Flexbox, responsive design, mobile-first patterns, and modern component architecture.');
  lines.push('');
  lines.push(`## Current User: ${username}`);
  lines.push('');

  if (imageDescriptions && imageDescriptions.length > 0) {
    lines.push('## Reference Images Provided by User');
    imageDescriptions.forEach((desc, i) => {
      lines.push(`- Image ${i + 1}: ${desc}`);
    });
    lines.push('');
  }

  if (cssVariables && cssVariables.length > 0) {
    lines.push('## Current CSS Variables (theme tokens you can modify)');
    const byCategory = {};
    cssVariables.filter(v => v.theme === 'default').forEach(v => {
      if (!byCategory[v.category]) byCategory[v.category] = [];
      byCategory[v.category].push(`${v.name}: ${v.value}`);
    });
    Object.entries(byCategory).forEach(([cat, vars]) => {
      lines.push(`\n### ${cat}`);
      vars.slice(0, 40).forEach(v => lines.push(`  ${v}`));
    });
    lines.push('');
  }

  if (componentFiles && componentFiles.length > 0) {
    lines.push('## Project Component Files (for layout/UX changes)');
    lines.push('You can propose modifications to these files for structural/layout changes.');
    lines.push(`Total files: ${componentFiles.length}`);
    lines.push('');

    // List all files first
    lines.push('### File listing:');
    componentFiles.forEach(f => {
      lines.push(`  ${f.path} (${f.lineCount} lines${f.truncated ? ', showing first 80' : ''})`);
    });
    lines.push('');

    // Include key files content (main CSS + top-level components)
    const priorityFiles = componentFiles
      .filter(f => /index\.css|App\.(jsx|tsx)|main\.(jsx|tsx)|layout/i.test(f.path))
      .slice(0, 5);
    const otherFiles = componentFiles
      .filter(f => !priorityFiles.includes(f) && !f.truncated)
      .slice(0, 10);

    [...priorityFiles, ...otherFiles].forEach(f => {
      lines.push(`### ${f.path}`);
      lines.push('```');
      lines.push(f.content);
      lines.push('```');
      lines.push('');
    });
  }

  lines.push('## Response Format');
  lines.push('Your response should include:');
  lines.push('1. A conversational design brief (what you\'re proposing and why, in human terms)');
  lines.push('');
  lines.push('2. For THEME TOKEN changes (colors, spacing vars, shadows vars) — a css-changes JSON block:');
  lines.push('```css-changes');
  lines.push('[');
  lines.push('  { "variable": "--bg-app", "value": "#0f1117", "reasoning": "Deeper background" }');
  lines.push(']');
  lines.push('```');
  lines.push('');
  lines.push('3. For VISUAL/LAYOUT changes (border-radius, gaps, grid columns, sizing, shapes, opacity, transforms) — a style-injection block.');
  lines.push('   This is RAW CSS that gets injected into the page live. Use this for ANY visual change that can be expressed as CSS rules.');
  lines.push('   PREFER THIS over file-changes whenever possible — it shows instantly in the preview.');
  lines.push('```style-injection');
  lines.push('/* Make grid images circular */');
  lines.push('img { border-radius: 50%; }');
  lines.push('.card { border-radius: 20px; padding: 24px; }');
  lines.push('.grid { gap: 24px; grid-template-columns: repeat(3, 1fr); }');
  lines.push('.sidebar { width: 280px; }');
  lines.push('```');
  lines.push('');
  lines.push('4. For STRUCTURAL changes that CANNOT be done with CSS (moving elements, adding/removing components, changing HTML structure) — a file-changes block:');
  lines.push('```file-changes');
  lines.push('[');
  lines.push('  {');
  lines.push('    "file": "src/components/Header.jsx",');
  lines.push('    "description": "Move search bar to the left",');
  lines.push('    "search": "the exact code to find and replace",');
  lines.push('    "replace": "the new code to replace it with"');
  lines.push('  }');
  lines.push(']');
  lines.push('```');
  lines.push('');
  lines.push('## IMPORTANT PRIORITY: style-injection > css-changes > file-changes');
  lines.push('- Visual changes (shapes, sizes, spacing, borders, shadows, transforms, grid layout, opacity) → use style-injection');
  lines.push('- Theme colors, font sizes defined as CSS variables → use css-changes');
  lines.push('- Moving/adding/removing HTML elements, changing component logic → use file-changes (LAST RESORT)');
  lines.push('- You can include ALL THREE blocks in one response');
  lines.push('- If asking clarifying questions, omit all blocks.');
  lines.push('');

  if (history.length > 0) {
    lines.push('## Conversation So Far');
    history.forEach(h => {
      lines.push(`${h.role === 'user' ? 'User' : 'Design AI'}: ${h.content.slice(0, 500)}`);
    });
    lines.push('');
  }

  lines.push(`## User's Request`);
  lines.push(message);

  return lines.join('\n');
};

router.post('/chat', async (req, res) => {
  try {
    const { message, username, serviceId, images } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const sessionKey = `design:${username}`;
    if (activeSessions.has(sessionKey)) {
      return res.status(409).json({ error: 'Design AI is still thinking. Please wait.' });
    }

    // Scan CSS and components if serviceId provided
    let cssVariables = [];
    let themes = {};
    let componentFiles = [];
    let serviceCwd = null;
    if (serviceId) {
      try {
        const services = getServices();
        const service = services.find(s => s.id === serviceId);
        if (service && service.cwd) {
          serviceCwd = service.cwd;
          const srcDir = path.join(service.cwd, 'src');
          const targetDir = fs.existsSync(srcDir) ? srcDir : service.cwd;
          const scanResult = scanCssVariables(targetDir, service.cwd);
          cssVariables = scanResult.variables;
          themes = scanResult.themes;
          componentFiles = scanComponentFiles(service.cwd);
        }
      } catch (e) { /* proceed without context */ }
    }

    // Image descriptions (URLs for reference)
    const imageDescriptions = (images || []).map((img, i) => img.annotation || `Reference image ${i + 1} (${img.originalName || img.filename})`);

    const history = loadHistory(username);
    const prompt = buildDesignPrompt(message, username, cssVariables, themes, imageDescriptions, history, componentFiles);

    let workDir;
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      workDir = settings.workingDirectory || process.cwd();
    } catch (e) { workDir = process.cwd(); }

    activeSessions.set(sessionKey, true);

    const claude = spawn('claude', ['--print', '--dangerously-skip-permissions'], {
      cwd: workDir,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    claude.stdin.write(prompt);
    claude.stdin.end();

    let output = '';
    let errorOutput = '';

    claude.stdout.on('data', (data) => { output += data.toString(); });
    claude.stderr.on('data', (data) => { errorOutput += data.toString(); });

    claude.on('close', (code) => {
      activeSessions.delete(sessionKey);

      if (code !== 0 && !output) {
        return res.status(500).json({ error: errorOutput || `Claude exited with code ${code}` });
      }

      const response = output.trim();

      // Parse CSS variable changes
      let cssChanges = [];
      const cssBlock = response.match(/```css-changes\s*([\s\S]*?)```/);
      if (cssBlock) {
        try { cssChanges = JSON.parse(cssBlock[1].trim()); } catch (e) { /* not valid JSON */ }
      }

      // Parse style injection (raw CSS rules for live preview)
      let styleInjection = '';
      const styleBlock = response.match(/```style-injection\s*([\s\S]*?)```/);
      if (styleBlock) {
        styleInjection = styleBlock[1].trim();
      }

      // Parse file/layout changes
      let fileChanges = [];
      const fileBlock = response.match(/```file-changes\s*([\s\S]*?)```/);
      if (fileBlock) {
        try { fileChanges = JSON.parse(fileBlock[1].trim()); } catch (e) { /* not valid JSON */ }
      }

      // Save history
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: response });
      saveHistory(username, history);

      res.json({ response, cssChanges, styleInjection, fileChanges, serviceCwd });
    });

    claude.on('error', (err) => {
      activeSessions.delete(sessionKey);
      res.status(500).json({ error: `Failed to start Claude CLI: ${err.message}` });
    });

    setTimeout(() => {
      if (activeSessions.has(sessionKey)) {
        claude.kill();
        activeSessions.delete(sessionKey);
      }
    }, 180000); // 3 min timeout for design tasks

  } catch (error) {
    logger.error({ err: error }, 'Design chat failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear design history
router.delete('/history', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username required' });
  const file = path.join(HISTORY_DIR, `${username}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ success: true });
});

// --- Design Sessions (save/load/list/delete) ---
router.post('/sessions', (req, res) => {
  try {
    const { username, name, serviceId, appliedChanges, styleInjection, fileChanges, messages, images } = req.body;
    if (!username || !name) return res.status(400).json({ error: 'username and name required' });
    const sessionId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const session = {
      id: sessionId, name, username, serviceId,
      appliedChanges: appliedChanges || [],
      styleInjection: styleInjection || '',
      fileChanges: fileChanges || [],
      messages: messages || [],
      images: images || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(SESSIONS_DIR, `${sessionId}.json`), JSON.stringify(session, null, 2));
    res.json({ success: true, session: { id: sessionId, name, createdAt: session.createdAt } });
  } catch (error) {
    logger.error({ err: error }, 'Save session failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sessions', (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const sessions = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8'));
        if (data.username !== username) return null;
        return { id: data.id, name: data.name, serviceId: data.serviceId, createdAt: data.createdAt, updatedAt: data.updatedAt, changeCount: (data.appliedChanges?.length || 0) + (data.styleInjection ? 1 : 0) + (data.fileChanges?.length || 0) };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(sessions);
  } catch (error) {
    logger.error({ err: error }, 'List sessions failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sessions/:id', (req, res) => {
  try {
    const fp = path.join(SESSIONS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Session not found' });
    res.json(JSON.parse(fs.readFileSync(fp, 'utf-8')));
  } catch (error) {
    logger.error({ err: error }, 'Load session failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/sessions/:id', (req, res) => {
  try {
    const fp = path.join(SESSIONS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Session not found' });
    const existing = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const updated = { ...existing, ...req.body, id: existing.id, username: existing.username, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    fs.writeFileSync(fp, JSON.stringify(updated, null, 2));
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Update session failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/sessions/:id', (req, res) => {
  try {
    const fp = path.join(SESSIONS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Session not found' });
    fs.unlinkSync(fp);
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Delete session failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Apply CSS Changes ---
router.post('/apply', (req, res) => {
  try {
    const { serviceId, changes } = req.body;
    if (!serviceId || !Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({ error: 'serviceId and changes array required' });
    }

    const services = getServices();
    const service = services.find(s => s.id === serviceId);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const srcDir = path.join(service.cwd, 'src');
    const targetDir = fs.existsSync(srcDir) ? srcDir : service.cwd;

    // Find CSS files and apply changes
    const applied = [];
    const failed = [];

    // Scan for CSS files containing the variables
    const cssFiles = findCssFiles(targetDir);

    for (const change of changes) {
      let wasApplied = false;
      for (const cssFile of cssFiles) {
        let content = fs.readFileSync(cssFile, 'utf-8');
        // Match the variable declaration in :root or default theme
        const regex = new RegExp(`(${escapeRegex(change.variable)}\\s*:\\s*)([^;]+)(;)`, 'g');
        if (regex.test(content)) {
          // Backup before first change
          const backupPath = cssFile + '.design-backup';
          if (!fs.existsSync(backupPath)) {
            fs.copyFileSync(cssFile, backupPath);
          }
          content = content.replace(regex, `$1${change.value}$3`);
          fs.writeFileSync(cssFile, content);
          applied.push({ variable: change.variable, value: change.value, file: path.relative(service.cwd, cssFile) });
          wasApplied = true;
          break;
        }
      }
      if (!wasApplied) failed.push({ variable: change.variable, reason: 'Variable not found in CSS files' });
    }

    res.json({ success: true, applied, failed });
  } catch (error) {
    logger.error({ err: error }, 'Design apply failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Apply File/Layout Changes (search & replace in component files) ---
router.post('/apply-files', (req, res) => {
  try {
    const { serviceId, changes } = req.body;
    if (!serviceId || !Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({ error: 'serviceId and changes array required' });
    }

    const services = getServices();
    const service = services.find(s => s.id === serviceId);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const applied = [];
    const failed = [];

    for (const change of changes) {
      try {
        const filePath = path.join(service.cwd, change.file);
        if (!fs.existsSync(filePath)) {
          failed.push({ file: change.file, reason: 'File not found' });
          continue;
        }

        let content = fs.readFileSync(filePath, 'utf-8');

        if (!content.includes(change.search)) {
          failed.push({ file: change.file, reason: 'Search string not found in file' });
          continue;
        }

        // Backup before modifying
        const backupPath = filePath + '.design-backup';
        if (!fs.existsSync(backupPath)) {
          fs.copyFileSync(filePath, backupPath);
        }

        content = content.replace(change.search, change.replace);
        fs.writeFileSync(filePath, content);
        applied.push({ file: change.file, description: change.description });
      } catch (e) {
        failed.push({ file: change.file, reason: e.message });
      }
    }

    res.json({ success: true, applied, failed });
  } catch (error) {
    logger.error({ err: error }, 'Design apply-files failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Prototypes ---
const PROTOTYPES_DIR = path.join(UPLOADS_DIR, 'prototypes');
if (!fs.existsSync(PROTOTYPES_DIR)) fs.mkdirSync(PROTOTYPES_DIR, { recursive: true });

// Cancel an active prototype generation session
router.delete('/prototype/session', (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username required' });

  const sessionKey = `prototype:${username}`;
  const session = activeSessions.get(sessionKey);
  if (!session || !session.process) {
    return res.json({ success: true, message: 'No active session' });
  }

  try {
    session.process.kill();
  } catch (e) { /* already dead */ }
  activeSessions.delete(sessionKey);
  res.json({ success: true, message: 'Session cancelled' });
});

// Generate a full HTML prototype via AI (SSE streaming)
router.post('/prototype/generate', async (req, res) => {
  try {
    const { message, username, serviceId, images, prototypeId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const sessionKey = `prototype:${username}`;
    if (activeSessions.has(sessionKey)) {
      return res.status(409).json({ error: 'AI is still generating. Please wait.' });
    }

    // Scan project for context
    let componentFiles = [];
    let cssVariables = [];
    let serviceCwd = null;
    if (serviceId) {
      try {
        const services = getServices();
        const service = services.find(s => s.id === serviceId);
        if (service && service.cwd) {
          serviceCwd = service.cwd;
          componentFiles = scanComponentFiles(service.cwd);
          const srcDir = path.join(service.cwd, 'src');
          const targetDir = fs.existsSync(srcDir) ? srcDir : service.cwd;
          const scanResult = scanCssVariables(targetDir, service.cwd);
          cssVariables = scanResult.variables;
        }
      } catch (e) { /* proceed */ }
    }

    // Load existing prototype for iteration
    let existingPrototype = '';
    if (prototypeId) {
      const existingPath = path.join(PROTOTYPES_DIR, `${prototypeId}.html`);
      if (fs.existsSync(existingPath)) {
        existingPrototype = fs.readFileSync(existingPath, 'utf-8');
      }
    }

    const imageDescriptions = (images || []).map((img, i) => img.annotation || `Reference image ${i + 1} (${img.originalName || img.filename})`);

    // Build prototype-specific prompt
    const lines = [];
    lines.push('You are a creative AI design partner. Your task is to generate a COMPLETE, self-contained HTML page that represents a full redesign of a web application.');
    lines.push('');
    lines.push('## Output Requirements');
    lines.push('- Generate a SINGLE HTML file with ALL CSS inline in a <style> tag');
    lines.push('- The page must be fully self-contained (no external dependencies except Google Fonts)');
    lines.push('- Include realistic content — use the actual section names, button labels, and navigation items from the real app');
    lines.push('- Make it responsive (works at desktop, tablet, and mobile widths)');
    lines.push('- Include hover states and transitions for interactivity');
    lines.push('- Use modern CSS (grid, flexbox, custom properties, backdrop-filter)');
    lines.push('- The HTML should be clean and well-structured');
    lines.push('');
    lines.push('## Design Quality Standards');
    lines.push('- Colors must be cohesive (use a consistent palette, not random colors)');
    lines.push('- Typography must have clear hierarchy (headings, body, captions)');
    lines.push('- Spacing must be consistent (use a spacing scale)');
    lines.push('- The design must feel professional and polished');
    lines.push('');

    if (imageDescriptions.length > 0) {
      lines.push('## Reference Images from User');
      imageDescriptions.forEach((desc, i) => lines.push(`- Image ${i + 1}: ${desc}`));
      lines.push('');
    }

    if (componentFiles.length > 0) {
      lines.push('## Real App Structure (mirror this layout)');
      lines.push('The prototype should have the same sections/pages as this real app:');
      lines.push('Components: ' + componentFiles.map(f => f.path).join(', '));
      lines.push('');
      const appFile = componentFiles.find(f => /App\.(jsx|tsx)$/i.test(f.path));
      if (appFile) {
        lines.push(`### ${appFile.path} (main layout reference)`);
        lines.push('```');
        lines.push(appFile.content.slice(0, 1500));
        lines.push('```');
        lines.push('');
      }
    }

    if (cssVariables.length > 0) {
      lines.push('## Current Design Tokens (for reference, you can change these)');
      const colorVars = cssVariables.filter(v => v.category === 'colors' && v.theme === 'default').slice(0, 20);
      colorVars.forEach(v => lines.push(`  ${v.name}: ${v.value}`));
      lines.push('');
    }

    if (existingPrototype) {
      lines.push('## Existing Prototype (iterate on this)');
      lines.push('The user wants modifications to this existing prototype:');
      lines.push('```html');
      lines.push(existingPrototype.slice(0, 15000));
      lines.push('```');
      lines.push('');
      lines.push('Apply the user\'s requested changes to this prototype. Return the COMPLETE updated HTML.');
      lines.push('');
    }

    lines.push('## CRITICAL: Output Format');
    lines.push('You MUST output the complete HTML page inside a code fence like this:');
    lines.push('');
    lines.push('```html');
    lines.push('<!DOCTYPE html>');
    lines.push('<html lang="en">');
    lines.push('<head>...(all CSS in a <style> tag)...</head>');
    lines.push('<body>...(full page layout)...</body>');
    lines.push('</html>');
    lines.push('```');
    lines.push('');
    lines.push('You may include a brief 1-2 sentence summary BEFORE the code fence, but the HTML must be complete and inside the fence.');
    lines.push('The HTML MUST be at least 100 lines long with real content and styling. Do NOT output a short stub.');
    lines.push('Do NOT describe what you would build — actually BUILD IT as HTML.');
    lines.push('Do NOT write files to disk — output the HTML in your response text.');
    lines.push('Do NOT use tools or file operations — just print the HTML.');
    lines.push('');
    lines.push(`## User's Design Vision`);
    lines.push(message);

    const prompt = lines.join('\n');

    let workDir;
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      workDir = settings.workingDirectory || process.cwd();
    } catch (e) { workDir = process.cwd(); }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendSSE('progress', { type: 'started', chars: 0 });

    // --print only so the AI outputs HTML to stdout
    const claude = spawn('claude', ['--print'], {
      cwd: workDir,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    activeSessions.set(sessionKey, { process: claude });

    claude.stdin.write(prompt);
    claude.stdin.end();

    let output = '';
    let errorOutput = '';
    let lastProgressAt = 0;

    claude.stdout.on('data', (data) => {
      output += data.toString();
      // Throttle progress events to every 500ms
      const now = Date.now();
      if (now - lastProgressAt > 500) {
        lastProgressAt = now;
        sendSSE('progress', { type: 'generating', chars: output.length });
      }
    });

    claude.stderr.on('data', (data) => { errorOutput += data.toString(); });

    // Handle client disconnect (cancel)
    req.on('close', () => {
      if (activeSessions.has(sessionKey)) {
        try { claude.kill(); } catch (e) { /* already dead */ }
        activeSessions.delete(sessionKey);
      }
    });

    claude.on('close', (code) => {
      activeSessions.delete(sessionKey);

      if (code !== 0 && !output) {
        sendSSE('error', { error: errorOutput || `Claude exited with code ${code}` });
        res.end();
        return;
      }

      // Extract HTML from response
      let html = output.trim();

      const patterns = [
        /```html\s*(<!DOCTYPE html[\s\S]*?<\/html>)\s*```/i,
        /```\s*(<!DOCTYPE html[\s\S]*?<\/html>)\s*```/i,
        /```html\s*(<html[\s\S]*?<\/html>)\s*```/i,
        /```\s*(<html[\s\S]*?<\/html>)\s*```/i,
        /(<!DOCTYPE html[\s\S]*<\/html>)/i,
        /(<html[\s\S]*<\/html>)/i,
      ];

      let extracted = null;
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) { extracted = match[1] || match[0]; break; }
      }

      if (extracted) {
        html = extracted;
      }

      if (!html.includes('<html') && !html.includes('<body')) {
        logger.warn({ outputLength: output.length, outputPreview: output.slice(0, 500) }, 'Prototype: AI output did not contain HTML');
        sendSSE('error', { error: 'AI did not generate valid HTML. Try again or use a simpler description.', raw: output.slice(0, 800) });
        res.end();
        return;
      }

      if (!html.includes('<!DOCTYPE')) {
        html = '<!DOCTYPE html>\n' + html;
      }

      // Save prototype
      const id = prototypeId || `proto-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const protoPath = path.join(PROTOTYPES_DIR, `${id}.html`);
      fs.writeFileSync(protoPath, html);

      sendSSE('complete', { id, url: `/api/design/prototypes/${id}.html`, size: html.length });
      res.end();
    });

    claude.on('error', (err) => {
      activeSessions.delete(sessionKey);
      sendSSE('error', { error: `Failed to start Claude CLI: ${err.message}` });
      res.end();
    });

    setTimeout(() => {
      if (activeSessions.has(sessionKey)) {
        try { claude.kill(); } catch (e) { /* already dead */ }
        activeSessions.delete(sessionKey);
        sendSSE('error', { error: 'Generation timed out after 5 minutes.' });
        res.end();
      }
    }, 300000);
  } catch (error) {
    logger.error({ err: error }, 'Prototype generation failed');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Serve prototype HTML files
router.use('/prototypes', express.static(PROTOTYPES_DIR));

// List saved prototypes
router.get('/prototypes', (req, res) => {
  try {
    if (!fs.existsSync(PROTOTYPES_DIR)) return res.json([]);
    const files = fs.readdirSync(PROTOTYPES_DIR).filter(f => f.endsWith('.html'));
    const protos = files.map(f => {
      const stats = fs.statSync(path.join(PROTOTYPES_DIR, f));
      return { id: f.replace('.html', ''), filename: f, size: stats.size, createdAt: stats.mtime.toISOString() };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(protos);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a prototype
router.delete('/prototypes/:id', (req, res) => {
  const fp = path.join(PROTOTYPES_DIR, `${req.params.id}.html`);
  if (fs.existsSync(fp)) { fs.unlinkSync(fp); res.json({ success: true }); }
  else res.status(404).json({ error: 'Not found' });
});

// --- Component breakdown for implementation ---
router.post('/prototype/implement', async (req, res) => {
  try {
    const { prototypeId, serviceId, username } = req.body;
    if (!prototypeId || !serviceId) return res.status(400).json({ error: 'prototypeId and serviceId required' });

    const sessionKey = `implement:${username}`;
    if (activeSessions.has(sessionKey)) {
      return res.status(409).json({ error: 'AI is still analyzing. Please wait.' });
    }

    const protoPath = path.join(PROTOTYPES_DIR, `${prototypeId}.html`);
    if (!fs.existsSync(protoPath)) return res.status(404).json({ error: 'Prototype not found' });

    const prototypeHtml = fs.readFileSync(protoPath, 'utf-8');

    const services = getServices();
    const service = services.find(s => s.id === serviceId);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const componentFiles = scanComponentFiles(service.cwd);
    const srcDir = path.join(service.cwd, 'src');
    const targetDir = fs.existsSync(srcDir) ? srcDir : service.cwd;
    const { variables: cssVariables } = scanCssVariables(targetDir, service.cwd);

    const lines = [];
    lines.push('You are analyzing an approved prototype design and the real app code to create a component-by-component implementation plan.');
    lines.push('');
    lines.push('## Approved Prototype HTML');
    lines.push('```html');
    lines.push(prototypeHtml.slice(0, 20000));
    lines.push('```');
    lines.push('');
    lines.push('## Real App Component Files');
    componentFiles.slice(0, 15).forEach(f => {
      lines.push(`### ${f.path}`);
      lines.push('```');
      lines.push(f.content.slice(0, 1500));
      lines.push('```');
    });
    lines.push('');
    lines.push('## Current CSS Variables');
    cssVariables.filter(v => v.theme === 'default').slice(0, 30).forEach(v => lines.push(`  ${v.name}: ${v.value}`));
    lines.push('');
    lines.push('## Task');
    lines.push('Compare the prototype with the real app and produce a JSON array of component-level changes needed.');
    lines.push('Each entry should describe ONE component to change.');
    lines.push('');
    lines.push('Return ONLY a JSON array fenced like this:');
    lines.push('```implementation-plan');
    lines.push('[');
    lines.push('  {');
    lines.push('    "component": "Header",');
    lines.push('    "file": "src/components/Header.jsx",');
    lines.push('    "description": "Human-readable description of what changes",');
    lines.push('    "cssChanges": [{"variable": "--header-bg", "value": "#1a1a2e"}],');
    lines.push('    "styleInjection": ".header { height: 64px; background: linear-gradient(...); }",');
    lines.push('    "fileChanges": [{"search": "old code", "replace": "new code", "description": "what this changes"}],');
    lines.push('    "complexity": "low|medium|high"');
    lines.push('  }');
    lines.push(']');
    lines.push('```');
    lines.push('Sort by complexity (low first). Include ALL components that need changes.');

    const prompt = lines.join('\n');

    let workDir;
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      workDir = settings.workingDirectory || process.cwd();
    } catch (e) { workDir = process.cwd(); }

    activeSessions.set(sessionKey, true);

    // --print only: this endpoint needs text output, not file writes
    const claude = spawn('claude', ['--print'], {
      cwd: workDir, shell: true, stdio: ['pipe', 'pipe', 'pipe']
    });

    claude.stdin.write(prompt);
    claude.stdin.end();

    let output = '';
    claude.stdout.on('data', (d) => { output += d.toString(); });

    claude.on('close', (code) => {
      activeSessions.delete(sessionKey);
      if (code !== 0 && !output) return res.status(500).json({ error: 'AI failed' });

      let plan = [];
      const planMatch = output.match(/```implementation-plan\s*([\s\S]*?)```/);
      if (planMatch) {
        try { plan = JSON.parse(planMatch[1].trim()); } catch (e) { /* parse error */ }
      }

      res.json({ plan, raw: output.trim() });
    });

    claude.on('error', (err) => {
      activeSessions.delete(sessionKey);
      res.status(500).json({ error: err.message });
    });

    setTimeout(() => {
      if (activeSessions.has(sessionKey)) { claude.kill(); activeSessions.delete(sessionKey); }
    }, 300000);
  } catch (error) {
    logger.error({ err: error }, 'Implementation plan failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Export ---
router.post('/export/css', (req, res) => {
  try {
    const { appliedChanges, styleInjection, projectName } = req.body;
    const lines = ['/* Design Studio Export */'];
    lines.push(`/* Project: ${projectName || 'Unknown'} */`);
    lines.push(`/* Exported: ${new Date().toISOString()} */`);
    lines.push('');
    if (appliedChanges && appliedChanges.length > 0) {
      lines.push('/* --- Theme Token Overrides --- */');
      lines.push(':root {');
      appliedChanges.forEach(c => {
        if (c.reasoning) lines.push(`  /* ${c.reasoning} */`);
        lines.push(`  ${c.variable}: ${c.value};`);
      });
      lines.push('}');
      lines.push('');
    }
    if (styleInjection) {
      lines.push('/* --- Style Rules --- */');
      lines.push(styleInjection);
      lines.push('');
    }
    const css = lines.join('\n');
    const filename = `design-${(projectName || 'export').toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.css`;
    res.set('Content-Type', 'text/css');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(css);
  } catch (error) {
    logger.error({ err: error }, 'Export CSS failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/export/json', (req, res) => {
  try {
    const { appliedChanges, styleInjection, projectName } = req.body;
    const theme = {
      name: projectName || 'Untitled Design',
      exportedAt: new Date().toISOString(),
      tokens: {},
      styleRules: styleInjection || '',
    };
    // Categorize tokens
    (appliedChanges || []).forEach(c => {
      let category = 'other';
      if (/color|bg|text|accent|fill|border|separator/i.test(c.variable)) category = 'colors';
      else if (/font|text-|leading|tracking/i.test(c.variable)) category = 'typography';
      else if (/space|gap|padding|margin|radius/i.test(c.variable)) category = 'spacing';
      else if (/shadow/i.test(c.variable)) category = 'shadows';
      if (!theme.tokens[category]) theme.tokens[category] = {};
      theme.tokens[category][c.variable] = { value: c.value, reasoning: c.reasoning || null };
    });
    const filename = `design-${(projectName || 'export').toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`;
    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(theme);
  } catch (error) {
    logger.error({ err: error }, 'Export JSON failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Helpers ---
function scanCssVariables(targetDir, baseDir) {
  const variables = [];
  const themes = {};
  const cssFiles = findCssFiles(targetDir);

  for (const filePath of cssFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const relativePath = path.relative(baseDir, filePath);
    const selectorRegex = /([^{}]+)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
    let match;
    while ((match = selectorRegex.exec(content)) !== null) {
      const selector = match[1].trim();
      const block = match[2];
      const varRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
      let varMatch;
      while ((varMatch = varRegex.exec(block)) !== null) {
        const name = varMatch[1];
        const value = varMatch[2].trim();
        let category = 'other';
        if (/color|bg|text|accent|fill|border|separator/i.test(name)) category = 'colors';
        else if (/font|text-|leading|tracking/i.test(name)) category = 'typography';
        else if (/space|gap|padding|margin|radius/i.test(name)) category = 'spacing';
        else if (/shadow/i.test(name)) category = 'shadows';

        let theme = 'default';
        if (/data-theme.*light/i.test(selector)) theme = 'light';
        else if (/data-theme.*oled/i.test(selector)) theme = 'oled';
        else if (/data-theme.*paper/i.test(selector)) theme = 'paper';

        if (!themes[theme]) themes[theme] = {};
        themes[theme][name] = value;
        variables.push({ name, value, category, theme, file: relativePath });
      }
    }
  }
  return { variables, themes };
}

function findCssFiles(dir) {
  const files = [];
  const scan = (d) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (/\.(css|scss|less)$/.test(entry.name)) files.push(full);
    }
  };
  scan(dir);
  return files;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
