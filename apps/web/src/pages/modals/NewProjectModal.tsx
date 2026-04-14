import { FileUp, Upload } from 'lucide-react';
import type { NewProjectModalProps } from './NewProjectModal.types';
import IndustryConfigPanel from './components/IndustryConfigPanel';
import IssueInputPanel from './components/IssueInputPanel';
import { useNewProjectModalController } from './hooks/useNewProjectModalController';
import SurfaceModal from '../impl/SurfaceModal';

export default function NewProjectModal(props: NewProjectModalProps) {
  const controller = useNewProjectModalController(props);
  const {
    isOpen,
    handleClose,
    isImporting,
    setIsImporting,
    handleImportProjectFile,
  } = controller;
  const steps: Array<{ id: string; label: string }> = [
    { id: 'input', label: '创建项目' },
  ];
  const currentIndex = 0;

  return (
    <SurfaceModal isOpen={isOpen} onClose={handleClose} title="创建新项目">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">FR-010 自然语言创建</p>
          <button
            onClick={() => setIsImporting((prev) => !prev)}
            className="text-[10px] font-bold text-primary hover:underline uppercase tracking-widest flex items-center gap-1"
          >
            <Upload size={12} />
            {isImporting ? '返回创建流程' : '导入项目定义'}
          </button>
        </div>

        {!isImporting ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {steps.map((item, index) => {
                  const done = currentIndex > index;
                  const active = currentIndex === index;
                  return (
                    <div key={item.id} className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-6 h-6 rounded-full border text-[10px] font-bold flex items-center justify-center ${
                          done
                            ? 'bg-primary/20 border-primary/50 text-primary'
                            : active
                              ? 'bg-accent/20 border-accent/50 text-accent'
                              : 'bg-white/5 border-border-subtle text-slate-500'
                        }`}
                      >
                        {index + 1}
                      </div>
                      <span className={`text-[11px] ${active ? 'text-white' : 'text-slate-500'}`}>{item.label}</span>
                      {index < steps.length - 1 && <div className="w-4 h-px bg-border-subtle" />}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <IndustryConfigPanel controller={controller} />
              <IssueInputPanel controller={controller} />
            </div>
          </>
        ) : (
          <div className="p-8 border-2 border-dashed border-border-subtle rounded-2xl bg-white/5 flex flex-col items-center justify-center space-y-4 group hover:border-primary/50 transition-all cursor-pointer">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
              <FileUp size={24} />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-white">点击或拖拽文件到此处</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest">支持 .json, .yaml, .md, .txt 项目文档</p>
            </div>
            <input
              type="file"
              className="hidden"
              id="project-file"
              accept=".txt,.md,.json,.yaml,.yml,.csv,.log,.xml"
              onChange={(event) => void handleImportProjectFile(event)}
            />
            <label
              htmlFor="project-file"
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-[10px] font-bold text-white transition-all cursor-pointer"
            >
              选择文件
            </label>
          </div>
        )}
      </div>
    </SurfaceModal>
  );
}
