import { useState, useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { INITIAL_AGENTS, INITIAL_PROJECTS } from './constants';
import { Project, AgentProfile, RoleType, TimelineEvent } from './types';
import { parseProjectIntent, generateAgentThinking } from './services/geminiService';
import { useAuth } from './contexts/AuthContext';
import { useTranslation } from './contexts/LanguageContext';
import { Settings } from 'lucide-react';
import { Login } from './components/Login';
import { WorkspaceShell } from './components/layout/WorkspaceShell';
import { Dashboard } from './components/pages/Dashboard';
import { Projects } from './components/pages/Projects';
import { ProjectRoom } from './components/pages/ProjectRoom';
import { Agents } from './components/pages/Agents';
import { AgentCommander } from './components/pages/AgentCommander';
import { Workspace } from './components/pages/Workspace';
import { System } from './components/pages/System';
import { Audit } from './components/pages/Audit';

export default function App() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'projects' | 'workspace' | 'agents' | 'system' | 'audit' | 'settings'>('dashboard');
  const [selectedAgent, setSelectedAgent] = useState<AgentProfile | null>(null);
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [agents, setAgents] = useState<AgentProfile[]>(INITIAL_AGENTS);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newRequirement, setNewRequirement] = useState('');
  const [isIntervening, setIsIntervening] = useState(false);
  const [liveStreamText, setLiveStreamText] = useState<string[]>([]);
  const [currentThinking, setCurrentThinking] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [understanding, setUnderstanding] = useState<{
    goal: string;
    plan: string[];
    steps: string[];
    risks: string[];
    suggestion: string;
  } | null>(null);

  // Mock initial project
  useEffect(() => {
    const mockProject: Project = {
      id: 'OCC-20260325-001',
      name: 'Intelligent Customer Service System',
      description: 'Develop an AI-driven customer support platform with multi-turn dialogue capabilities.',
      status: 'active',
      currentStage: 'DESIGN',
      progress: 65,
      riskLevel: 'low',
      priority: 'high',
      startDate: '2026-03-01',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      client: 'Global Tech Corp',
      team: ['PM', 'ANALYST', 'PRODUCT', 'ARCH', 'DEV', 'QA'],
      deliverables: [
        { id: 'd1', name: 'Requirement Analysis Doc', type: 'markdown', content: '# Analysis...', createdAt: '2026-03-25T10:00:00Z', createdBy: 'ANALYST' }
      ],
      timeline: [
        { id: 't1', timestamp: '2026-03-25T09:00:00Z', type: 'stage_start', title: 'Project Initialized', content: 'Project created by user.' },
        { id: 't2', timestamp: '2026-03-25T10:30:00Z', type: 'agent_action', agentId: 'ANALYST', title: 'Analysis Completed', content: 'Requirement analysis document submitted.' },
        { id: 't3', timestamp: '2026-03-25T11:00:00Z', type: 'approval_request', agentId: 'PM', title: 'Approval Required', content: 'Please review the analysis document to proceed to design.' }
      ],
      tasks: [],
      confirmations: []
    };
    setProjects([mockProject]);
  }, []);

  useEffect(() => {
    if (selectedProject && selectedProject.status === 'active') {
      const interval = setInterval(async () => {
        const thinking = await generateAgentThinking(
          selectedProject.team[Math.floor(Math.random() * selectedProject.team.length)],
          selectedProject.currentStage,
          selectedProject.description
        );
        setCurrentThinking(thinking || "");
        setLiveStreamText(prev => [...prev.slice(-10), `[${new Date().toLocaleTimeString()}] ${thinking}`]);
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [selectedProject]);

  const handleCreateProject = async () => {
    if (!newRequirement) return;
    setIsCreating(true);
    try {
      const intent = await parseProjectIntent(newRequirement);
      const newProject: Project = {
        id: `OCC-${new Date().toISOString().split('T')[0].replace(/-/g, '')}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
        name: intent.keywords[0] || 'New Project',
        description: newRequirement,
        status: 'active',
        currentStage: 'INIT',
        progress: 10,
        riskLevel: 'low',
        priority: 'medium',
        startDate: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        client: 'Internal',
        team: intent.suggestedTeam as RoleType[],
        deliverables: [],
        timeline: [{ id: 't0', timestamp: new Date().toISOString(), type: 'stage_start', title: 'Project Created', content: 'AI intent parsed and team assigned.' }],
        tasks: [],
        confirmations: []
      };
      setProjects([newProject, ...projects]);
      setSelectedProject(newProject);
      setIsCreating(false);
      setNewRequirement('');
    } catch (error) {
      console.error(error);
      setIsCreating(false);
    }
  };

  const handleSyncProjects = async () => {
    setIsSyncing(true);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const syncedProject: Project = {
      id: `OCC-SYNC-${Date.now()}`,
      name: 'OpenClaw External Mission',
      description: 'Project synchronized from OpenClaw autonomous agent.',
      status: 'active',
      currentStage: 'ANALYSIS',
      progress: 30,
      riskLevel: 'medium',
      priority: 'high',
      startDate: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      client: 'OpenClaw Network',
      team: ['PM', 'DEV', 'QA'],
      deliverables: [],
      timeline: [{ id: 'ts1', timestamp: new Date().toISOString(), type: 'stage_start', title: 'Synced from OpenClaw', content: 'External project data imported.' }],
      tasks: [],
      confirmations: []
    };
    setProjects(prev => [syncedProject, ...prev]);
    setIsSyncing(false);
  };

  const handleUpdateAgent = (roleId: RoleType, updates: Partial<AgentProfile>) => {
    setAgents(prev => prev.map(a => a.roleId === roleId ? { ...a, ...updates } : a));
  };

  const handleSendInstruction = async () => {
    if (!instruction.trim()) return;
    setUnderstanding({
      goal: `执行指令: ${instruction}`,
      plan: ['分析指令意图', '检索相关上下文', '生成执行步骤'],
      steps: ['步骤 1: 验证指令合法性', '步骤 2: 执行核心逻辑', '步骤 3: 反馈执行结果'],
      risks: ['指令可能存在歧义', '执行环境可能受限'],
      suggestion: '建议在执行前确认关键参数。'
    });
    setInstruction('');
  };

  if (!user) return <Login />;

  const renderContent = () => {
    if (selectedProject) {
      return (
        <ProjectRoom 
          project={selectedProject} 
          onBack={() => setSelectedProject(null)}
          onIntervene={() => setIsIntervening(true)}
          onSimulateRequest={() => {
            const newEvent: TimelineEvent = {
              id: `t-${Date.now()}`,
              timestamp: new Date().toISOString(),
              type: 'approval_request',
              agentId: 'PM',
              title: t('common.approvalRequested'),
              content: t('common.approvalContent')
            };
            setProjects(prev => prev.map(p => p.id === selectedProject.id ? { ...p, timeline: [newEvent, ...p.timeline] } : p));
            setSelectedProject({ ...selectedProject, timeline: [newEvent, ...selectedProject.timeline] });
          }}
          liveStreamText={liveStreamText}
          currentThinking={currentThinking}
          isIntervening={isIntervening}
          setIsIntervening={setIsIntervening}
        />
      );
    }

    if (selectedAgent) {
      return (
        <AgentCommander 
          agent={selectedAgent}
          onBack={() => {
            setSelectedAgent(null);
            setUnderstanding(null);
          }}
          onUpdateAgent={handleUpdateAgent}
          instruction={instruction}
          setInstruction={setInstruction}
          handleSendInstruction={handleSendInstruction}
          understanding={understanding}
          setUnderstanding={setUnderstanding}
        />
      );
    }

    switch (activeTab) {
      case 'dashboard':
        return (
          <Dashboard 
            projects={projects}
            agents={agents}
            onNewProject={() => setIsCreating(true)}
            onSync={handleSyncProjects}
            isSyncing={isSyncing}
            onSelectProject={setSelectedProject}
            isCreating={isCreating}
            newRequirement={newRequirement}
            setNewRequirement={setNewRequirement}
            handleCreateProject={handleCreateProject}
            setIsCreating={setIsCreating}
          />
        );
      case 'projects':
        return (
          <Projects 
            projects={projects} 
            onSelectProject={setSelectedProject} 
            onNewProject={() => setIsCreating(true)}
          />
        );
      case 'agents':
        return <Agents agents={agents} onSelectAgent={setSelectedAgent} />;
      case 'workspace':
        return <Workspace />;
      case 'system':
        return <System />;
      case 'audit':
        return <Audit />;
      case 'settings':
        return (
          <div className="flex flex-col items-center justify-center h-[60vh] text-slate-500 gap-4">
            <Settings size={48} className="animate-spin-slow opacity-20" />
            <p className="italic font-medium uppercase tracking-widest text-xs">System configuration module coming soon</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <WorkspaceShell 
      activeTab={activeTab} 
      setActiveTab={(tab) => {
        setActiveTab(tab);
        setSelectedProject(null);
        setSelectedAgent(null);
      }}
      onNewProject={() => setIsCreating(true)}
      projects={projects}
      agents={agents}
      onSelectProject={setSelectedProject}
      onSelectAgent={setSelectedAgent}
    >
      <AnimatePresence mode="wait">
        <div key={selectedProject?.id || selectedAgent?.roleId || activeTab}>
          {renderContent()}
        </div>
      </AnimatePresence>
    </WorkspaceShell>
  );
}
