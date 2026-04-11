import { createServer } from 'node:http';
import { URL } from 'node:url';

const port = Number(process.env.PORT || 3001);
const role = String(process.env.SERVICE_ROLE || 'hermes').toLowerCase();

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function longPrd() {
  return [
    '# Product Requirement Document',
    '## Problem',
    'Users need a reliable collaboration platform to coordinate multiple specialized agents.',
    '## Goals',
    '1. Improve planning accuracy.',
    '2. Increase delivery speed.',
    '3. Keep execution trace auditable.',
    '## Scope',
    'The platform supports requirement design, visual design, development and QA acceptance stages.',
    '## Functional Requirements',
    '- Stage orchestration with quality gates.',
    '- Knowledge retrieval and memory sync.',
    '- Human override for critical decisions.',
    '## Non-Functional Requirements',
    '- Stable API for integrations.',
    '- Clear fallback behavior for agent failures.',
    '- Observable logs and health checks.',
    '## Acceptance Criteria',
    '- Workflow can start and complete.',
    '- Artifacts generated for each stage.',
    '- Quality gate checks can block and release stages.',
  ].join('\n');
}

function buildArtifacts(templateKey, payload) {
  const key = String(templateKey || '').toLowerCase();
  const task = String(payload?.task || '');
  const projectId = String(payload?.context?.projectId || payload?.projectId || 'project');

  if (key.includes('requirement')) {
    return [{ name: 'prd', type: 'document', format: 'markdown', content: longPrd() }];
  }

  if (key.includes('visual') || key.includes('ui_design') || key.includes('design')) {
    return [
      {
        name: 'mockups',
        type: 'design',
        format: 'json',
        content: JSON.stringify([
          { page: 'dashboard', frame: '1440x1024', notes: 'Hero summary + activity feed' },
          { page: 'project-detail', frame: '1440x1024', notes: 'Timeline + stage cards' },
        ]),
      },
      {
        name: 'designTokens',
        type: 'tokens',
        format: 'json',
        content: JSON.stringify({
          color: { brand: '#0f766e', accent: '#f59e0b' },
          radius: { card: 16 },
          typography: { heading: 'Space Grotesk', body: 'IBM Plex Sans' },
        }),
      },
    ];
  }

  if (key.includes('tech')) {
    return [
      {
        name: 'techSpec',
        type: 'document',
        format: 'markdown',
        content: `# Technical Design\n\nProject: ${projectId}\n\nTask: ${task}\n\nArchitecture: service-based NestJS with staged orchestration.`,
      },
      {
        name: 'apiContract',
        type: 'json',
        format: 'json',
        content: JSON.stringify({ endpoints: ['/api/v1/projects', '/api/v1/knowledge/search'] }),
      },
    ];
  }

  if (key.includes('code')) {
    return [
      {
        name: 'codeRepo',
        type: 'repo',
        format: 'git',
        content: `https://example.local/${projectId}/repo`,
      },
      {
        name: 'sourceCode',
        type: 'code',
        format: 'typescript',
        content: 'export const ok = true;\n',
      },
    ];
  }

  if (key.includes('qa')) {
    return [
      {
        name: 'testReport',
        type: 'report',
        format: 'markdown',
        content: '# QA Report\n\nResult: PASS\n\nNo critical defects found.',
      },
      {
        name: 'approvalStatus',
        type: 'status',
        format: 'text',
        content: 'approved',
      },
    ];
  }

  return [
    {
      name: 'artifact',
      type: 'text',
      format: 'markdown',
      content: `Task completed: ${task || 'n/a'}`,
    },
  ];
}

function buildExecutionResult(payload) {
  const artifacts = buildArtifacts(payload?.templateKey, payload);
  return {
    success: true,
    artifacts,
    tool_calls: [{ tool: 'runtime-mock', status: 'ok' }],
    toolCalls: [{ tool: 'runtime-mock', status: 'ok' }],
    decisions: [{ decision: 'auto-generated-artifacts' }],
    errors: [],
    resolution: 'completed',
  };
}

async function handleHermes(req, res, pathname) {
  if (req.method === 'GET' && (pathname === '/health' || pathname === '/mcp/health')) {
    send(res, 200, { status: 'healthy', role: 'hermes' });
    return;
  }

  if (req.method === 'POST' && pathname === '/mcp') {
    const body = await readJson(req);
    const method = String(body?.method || '');
    const params = body?.params || {};
    let result = {};
    if (method === 'ping') {
      result = { status: 'ok' };
    } else if (method === 'execute_task') {
      result = buildExecutionResult(params);
    } else if (method === 'import_skill') {
      result = { imported: true };
    } else if (method === 'export_skills') {
      result = { skills: [] };
    } else if (method === 'export_memory') {
      result = { memories: [] };
    }
    send(res, 200, { jsonrpc: '2.0', id: body?.id ?? null, result });
    return;
  }

  if (req.method === 'POST' && pathname === '/mcp/execute') {
    const body = await readJson(req);
    send(res, 200, buildExecutionResult(body));
    return;
  }

  if (req.method === 'POST' && pathname === '/mcp/skills/import') {
    send(res, 200, { success: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/mcp/skills/export') {
    send(res, 200, { skills: [] });
    return;
  }

  if (req.method === 'POST' && pathname === '/mcp/memory/export') {
    send(res, 200, { memories: [] });
    return;
  }

  if (req.method === 'POST' && pathname === '/fallback') {
    const body = await readJson(req);
    if (String(body?.method || '') === 'execute_task') {
      send(res, 200, buildExecutionResult(body?.payload || {}));
      return;
    }
    send(res, 200, { success: true });
    return;
  }

  send(res, 404, { error: 'not_found', role: 'hermes' });
}

async function handleOpenClaw(req, res, pathname) {
  if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
    send(res, 200, { status: 'ok', role: 'openclaw' });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/execute') {
    const body = await readJson(req);
    send(res, 200, buildExecutionResult(body));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/skills') {
    send(res, 201, { success: true });
    return;
  }

  send(res, 404, { error: 'not_found', role: 'openclaw' });
}

async function handleStitch(req, res, pathname) {
  if (req.method === 'GET' && (pathname === '/health' || pathname === '/stitch/health')) {
    send(res, 200, { status: 'ok', role: 'stitch' });
    return;
  }

  if (req.method === 'POST' && pathname === '/stitch') {
    const body = await readJson(req);
    const base = Array.isArray(body?.artifacts) ? body.artifacts : [];
    const stageKey = String(body?.stageKey || '').toLowerCase();
    let artifacts = base;

    if (stageKey.includes('visual') && base.length === 0) {
      artifacts = buildArtifacts('visual_design', body);
    }

    send(res, 200, {
      artifacts,
      meta: {
        role: 'stitch',
        appliedTools: Array.isArray(body?.requiredTools) ? body.requiredTools : [],
      },
    });
    return;
  }

  send(res, 404, { error: 'not_found', role: 'stitch' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (role === 'hermes') {
      await handleHermes(req, res, pathname);
      return;
    }

    if (role === 'openclaw') {
      await handleOpenClaw(req, res, pathname);
      return;
    }

    if (role === 'stitch') {
      await handleStitch(req, res, pathname);
      return;
    }

    send(res, 500, { error: `unknown SERVICE_ROLE: ${role}` });
  } catch (error) {
    send(res, 500, { error: (error && error.message) || 'runtime error', role });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[agent-runtime-mock] role=${role} listening on :${port}`);
});
