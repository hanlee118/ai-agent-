import { AgentProfile, Project } from "./types";

export const INITIAL_AGENTS: AgentProfile[] = [
  {
    roleId: 'PM',
    name: 'Aria',
    title: 'Senior Project Manager',
    soul: 'Professional, organized, and proactive. Aria ensures that every project stays on track and that all stakeholders are aligned.',
    sop: '1. Initialize project scope and goals. 2. Assign tasks to relevant agents. 3. Monitor progress and handle blockers. 4. Facilitate communication between team members. 5. Review final deliverables.',
    model: 'gemini-3.1-pro-preview',
    availableModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
    isAutonomous: true,
    skills: { professional: 95, collaboration: 90, learning: 85, stability: 98, innovation: 80 },
    status: 'idle',
    load: 0,
    performance: 4.9,
    projectsCount: 12,
    lastActive: '2026-03-25T14:30:00Z',
    recentTasks: ['Project Alpha Scope Definition', 'Weekly Sync Meeting']
  },
  {
    roleId: 'ANALYST',
    name: 'Benton',
    title: 'Business Analyst',
    soul: 'Analytical, detail-oriented, and insightful. Benton excels at breaking down complex requirements into actionable insights.',
    sop: '1. Gather requirements from stakeholders. 2. Conduct market and user research. 3. Create detailed functional specifications. 4. Validate requirements with the team. 5. Support the development process with clarifications.',
    model: 'gemini-3-flash-preview',
    availableModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
    isAutonomous: false,
    skills: { professional: 90, collaboration: 85, learning: 95, stability: 92, innovation: 88 },
    status: 'busy',
    load: 75,
    performance: 4.7,
    projectsCount: 8,
    lastActive: '2026-03-25T15:15:00Z',
    recentTasks: ['User Persona Mapping', 'Competitor Analysis']
  },
  {
    roleId: 'ARCH',
    name: 'Cyrus',
    title: 'System Architect',
    soul: 'Visionary, technical, and strategic. Cyrus designs robust and scalable systems that meet long-term business goals.',
    sop: '1. Define system architecture and technology stack. 2. Design database schemas and API contracts. 3. Ensure system security and performance. 4. Review technical designs from the team. 5. Provide guidance on complex technical challenges.',
    model: 'gemini-3.1-pro-preview',
    availableModels: ['gemini-3.1-pro-preview'],
    isAutonomous: true,
    skills: { professional: 98, collaboration: 80, learning: 92, stability: 95, innovation: 90 },
    status: 'idle',
    load: 20,
    performance: 4.8,
    projectsCount: 15,
    lastActive: '2026-03-25T12:00:00Z',
    recentTasks: ['Microservices Design', 'Database Migration Plan']
  },
  {
    roleId: 'DEV',
    name: 'Dante',
    title: 'Full Stack Developer',
    soul: 'Efficient, creative, and problem-solver. Dante turns designs into reality with clean and performant code.',
    sop: '1. Implement frontend and backend features. 2. Write unit and integration tests. 3. Optimize code for performance and scalability. 4. Collaborate with designers and architects. 5. Participate in code reviews.',
    model: 'gemini-3-flash-preview',
    availableModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
    isAutonomous: true,
    skills: { professional: 92, collaboration: 88, learning: 90, stability: 85, innovation: 95 },
    status: 'busy',
    load: 90,
    performance: 4.6,
    projectsCount: 20,
    lastActive: '2026-03-25T15:25:00Z',
    recentTasks: ['Auth Module Implementation', 'UI Component Library']
  },
  {
    roleId: 'DESIGN',
    name: 'Elena',
    title: 'UI/UX Designer',
    soul: 'Creative, empathetic, and aesthetic. Elena crafts beautiful and intuitive user experiences.',
    sop: '1. Create wireframes and prototypes. 2. Design high-fidelity UI mockups. 3. Conduct user testing and gather feedback. 4. Maintain the design system. 5. Collaborate with developers on implementation.',
    model: 'gemini-3-flash-preview',
    availableModels: ['gemini-3-flash-preview'],
    isAutonomous: false,
    skills: { professional: 88, collaboration: 95, learning: 85, stability: 90, innovation: 98 },
    status: 'idle',
    load: 10,
    performance: 4.9,
    projectsCount: 10,
    lastActive: '2026-03-25T10:00:00Z',
    recentTasks: ['Design System Audit', 'Mobile App Redesign']
  }
];

export const INITIAL_PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'OpenClaw Platform Upgrade',
    description: 'Enhancing the core platform with advanced agent control and workspace management features.',
    status: 'active',
    currentStage: 'DEV',
    progress: 65,
    riskLevel: 'low',
    priority: 'high',
    startDate: '2026-03-01',
    budget: '$50,000',
    client: 'Internal',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-25T15:00:00Z',
    team: ['PM', 'ARCH', 'DEV', 'DESIGN'],
    deliverables: [
      { id: 'd1', name: 'PRD v2.0', type: 'markdown', content: '# PRD...', createdAt: '2026-03-05T00:00:00Z', createdBy: 'PM' },
      { id: 'd2', name: 'System Architecture', type: 'pdf', content: 'Architecture diagram...', createdAt: '2026-03-10T00:00:00Z', createdBy: 'ARCH' }
    ],
    timeline: [
      { id: 't1', timestamp: '2026-03-01T09:00:00Z', type: 'stage_start', title: 'Project Kickoff', content: 'Project officially started.' },
      { id: 't2', timestamp: '2026-03-15T14:00:00Z', type: 'agent_action', agentId: 'DEV', title: 'Backend Setup', content: 'Core API structure implemented.' }
    ],
    tasks: [
      { id: 'task1', projectId: 'p1', title: 'Implement Agent Commander', description: 'Create the detailed agent view.', assignee: 'DEV', priority: 'high', status: 'in_progress', progress: 40, createdAt: '2026-03-20T00:00:00Z' },
      { id: 'task2', projectId: 'p1', title: 'Workspace Mapping', description: 'Implement physical path mapping.', assignee: 'ARCH', priority: 'medium', status: 'todo', progress: 0, createdAt: '2026-03-22T00:00:00Z' }
    ],
    confirmations: [
      { id: 'c1', projectId: 'p1', agentId: 'ARCH', type: 'architecture', title: 'Database Selection', goal: 'Choosing between PostgreSQL and MongoDB.', steps: ['Evaluate performance', 'Check scalability'], risks: ['Data consistency'], options: [{ id: 'opt1', label: 'PostgreSQL', isRecommended: true }, { id: 'opt2', label: 'MongoDB' }], status: 'pending', createdAt: '2026-03-24T00:00:00Z' }
    ]
  }
];
