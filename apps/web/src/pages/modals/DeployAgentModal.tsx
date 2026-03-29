import DeployAgentModalPanel from '../../features/deploy-agent/DeployAgentModal';
import { agents, models, projects } from '../../lib/runtimeCollections';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onDeployed?: () => Promise<void> | void;
};

export default function DeployAgentModal({
  isOpen,
  onClose,
  addToast,
  onDeployed,
}: Props) {
  return (
    <DeployAgentModalPanel
      isOpen={isOpen}
      onClose={onClose}
      addToast={addToast}
      onDeployed={onDeployed}
      agents={agents}
      projects={projects}
      models={models}
    />
  );
}
