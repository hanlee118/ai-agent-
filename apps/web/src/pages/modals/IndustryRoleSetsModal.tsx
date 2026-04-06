import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import {
  roleSetsApi,
  type CreateIndustryRoleSetPayload,
  type IndustryRoleSetSummary,
  type RoleId,
  type RoleSetStatus,
  type UpdateIndustryRoleSetPayload,
} from '../../lib/api/roleSetsApi';
import SurfaceModal from '../impl/SurfaceModal';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onUpdated?: () => Promise<void> | void;
};

type FormState = {
  industryCode: string;
  industryName: string;
  roleIds: RoleId[];
  defaultSoulRoleId: RoleId;
  status: RoleSetStatus;
};

const ROLE_OPTIONS: Array<{ id: RoleId; label: string }> = [
  { id: 'ROLE_ASSISTANT', label: '总助理' },
  { id: 'ROLE_PM', label: '项目经理' },
  { id: 'ROLE_ANALYST', label: '需求分析师' },
  { id: 'ROLE_PRODUCT', label: '产品总监' },
  { id: 'ROLE_DESIGN', label: '视觉设计总监' },
  { id: 'ROLE_ARCH', label: '研发总监' },
  { id: 'ROLE_DEV', label: '研发经理' },
  { id: 'ROLE_QA', label: '测试工程师' },
  { id: 'ROLE_HR', label: 'HR总监' },
];

const EMPTY_FORM: FormState = {
  industryCode: '',
  industryName: '',
  roleIds: ['ROLE_ANALYST', 'ROLE_PRODUCT', 'ROLE_DESIGN', 'ROLE_DEV', 'ROLE_QA'],
  defaultSoulRoleId: 'ROLE_ANALYST',
  status: 'active',
};

function sortByCode(list: IndustryRoleSetSummary[]) {
  return [...list].sort((left, right) => left.industryCode.localeCompare(right.industryCode));
}

function toFormState(item: IndustryRoleSetSummary): FormState {
  return {
    industryCode: item.industryCode,
    industryName: item.industryName,
    roleIds: item.roleIds,
    defaultSoulRoleId: item.defaultSoulRoleId,
    status: item.status,
  };
}

export default function IndustryRoleSetsModal({ isOpen, onClose, addToast, onUpdated }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [items, setItems] = useState<IndustryRoleSetSummary[]>([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const selectedItem = useMemo(
    () => items.find((item) => item.industryCode === selectedCode) || null,
    [items, selectedCode],
  );

  const loadItems = async () => {
    setLoading(true);
    try {
      const list = await roleSetsApi.list();
      const sorted = sortByCode(list);
      setItems(sorted);
      if (sorted.length === 0) {
        setSelectedCode('');
        setIsCreateMode(true);
        setForm(EMPTY_FORM);
      } else {
        const nextSelected = sorted.find((item) => item.industryCode === selectedCode)?.industryCode || sorted[0].industryCode;
        const selected = sorted.find((item) => item.industryCode === nextSelected) || sorted[0];
        setSelectedCode(selected.industryCode);
        setIsCreateMode(false);
        setForm(toFormState(selected));
      }
    } catch (error) {
      addToast(`加载行业角色集失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleRole = (roleId: RoleId, checked: boolean) => {
    setForm((prev) => {
      const nextRoleIds = checked
        ? Array.from(new Set([...prev.roleIds, roleId]))
        : prev.roleIds.filter((item) => item !== roleId);
      const nextSoul = nextRoleIds.includes(prev.defaultSoulRoleId) ? prev.defaultSoulRoleId : (nextRoleIds[0] || 'ROLE_ANALYST');
      return {
        ...prev,
        roleIds: nextRoleIds,
        defaultSoulRoleId: nextSoul,
      };
    });
  };

  const validateForm = () => {
    const industryCode = form.industryCode.trim().toLowerCase();
    const industryName = form.industryName.trim();
    if (!industryCode || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(industryCode)) {
      addToast('行业编码格式不正确（小写字母/数字/下划线/中划线）', 'error');
      return null;
    }
    if (!industryName) {
      addToast('请填写行业名称', 'error');
      return null;
    }
    if (form.roleIds.length === 0) {
      addToast('请至少选择一个角色', 'error');
      return null;
    }
    if (!form.roleIds.includes(form.defaultSoulRoleId)) {
      addToast('灵魂角色必须在角色列表中', 'error');
      return null;
    }
    return {
      industryCode,
      industryName,
    };
  };

  const handleCreate = async () => {
    const valid = validateForm();
    if (!valid) {
      return;
    }
    const payload: CreateIndustryRoleSetPayload = {
      industryCode: valid.industryCode,
      industryName: valid.industryName,
      roleIds: form.roleIds,
      defaultSoulRoleId: form.defaultSoulRoleId,
      status: form.status,
    };

    setSaving(true);
    try {
      await roleSetsApi.create(payload);
      addToast(`已创建行业角色集：${valid.industryName}`, 'success');
      await loadItems();
      setSelectedCode(valid.industryCode);
      setIsCreateMode(false);
      if (onUpdated) {
        await onUpdated();
      }
    } catch (error) {
      addToast(`创建失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedItem) {
      addToast('请先选择一个行业角色集', 'error');
      return;
    }
    const valid = validateForm();
    if (!valid) {
      return;
    }

    const payload: UpdateIndustryRoleSetPayload = {
      industryCode: selectedItem.industryCode,
      industryName: valid.industryName,
      roleIds: form.roleIds,
      defaultSoulRoleId: form.defaultSoulRoleId,
      status: form.status,
    };

    setSaving(true);
    try {
      await roleSetsApi.update(selectedItem.industryCode, payload);
      addToast(`已更新行业角色集：${valid.industryName}`, 'success');
      await loadItems();
      setSelectedCode(selectedItem.industryCode);
      setIsCreateMode(false);
      if (onUpdated) {
        await onUpdated();
      }
    } catch (error) {
      addToast(`更新失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedItem) {
      addToast('请先选择一个行业角色集', 'error');
      return;
    }
    const shouldDelete = window.confirm(`确定删除行业角色集「${selectedItem.industryName}」吗？`);
    if (!shouldDelete) {
      return;
    }

    setDeleting(true);
    try {
      await roleSetsApi.remove(selectedItem.industryCode);
      addToast(`已删除行业角色集：${selectedItem.industryName}`, 'success');
      await loadItems();
      if (onUpdated) {
        await onUpdated();
      }
    } catch (error) {
      addToast(`删除失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const startCreate = () => {
    setIsCreateMode(true);
    setSelectedCode('');
    setForm(EMPTY_FORM);
  };

  const startEdit = (item: IndustryRoleSetSummary) => {
    setIsCreateMode(false);
    setSelectedCode(item.industryCode);
    setForm(toFormState(item));
  };

  return (
    <SurfaceModal
      isOpen={isOpen}
      onClose={onClose}
      title="行业角色集管理"
      panelClassName="max-w-6xl"
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] min-h-[560px]">
        <aside className="border-r border-border-subtle p-5 space-y-4 bg-white/5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">行业角色集</h3>
            <button
              onClick={() => void loadItems()}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="刷新"
            >
              <RefreshCcw size={16} />
            </button>
          </div>

          <button
            onClick={startCreate}
            className="w-full py-2.5 rounded-xl bg-primary text-surface text-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            新建行业角色集
          </button>

          <div className="space-y-2 max-h-[430px] overflow-auto pr-1">
            {items.map((item) => {
              const active = !isCreateMode && item.industryCode === selectedCode;
              return (
                <button
                  key={item.id}
                  onClick={() => startEdit(item)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    active
                      ? 'bg-primary/10 border-primary/40'
                      : 'bg-surface-muted border-border-subtle hover:border-primary/30'
                  }`}
                >
                  <p className="text-sm font-semibold text-white">{item.industryName}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{item.industryCode}</p>
                </button>
              );
            })}
            {!loading && items.length === 0 && (
              <p className="text-xs text-slate-500">暂无行业角色集，请先创建。</p>
            )}
          </div>
        </aside>

        <section className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-white">
                {isCreateMode ? '新建行业角色集' : '编辑行业角色集'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                维护新建项目时可选的行业角色模板（灵魂角色、角色集合、状态）。
              </p>
            </div>
            {!isCreateMode && selectedItem && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-2 rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/10 text-xs font-semibold flex items-center gap-2 disabled:opacity-60"
              >
                <Trash2 size={14} />
                {deleting ? '删除中...' : '删除'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">行业编码</label>
              <input
                value={form.industryCode}
                onChange={(event) => setField('industryCode', event.target.value)}
                placeholder="ecommerce"
                disabled={!isCreateMode}
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">行业名称</label>
              <input
                value={form.industryName}
                onChange={(event) => setField('industryName', event.target.value)}
                placeholder="电商零售"
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">角色集合</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {ROLE_OPTIONS.map((role) => {
                const checked = form.roleIds.includes(role.id);
                return (
                  <label
                    key={role.id}
                    className={`rounded-xl border px-3 py-2.5 text-xs cursor-pointer transition-colors ${
                      checked
                        ? 'bg-primary/10 border-primary/40 text-white'
                        : 'bg-surface-muted border-border-subtle text-slate-400 hover:border-primary/20'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={(event) => toggleRole(role.id, event.target.checked)}
                    />
                    <div className="font-semibold">{role.label}</div>
                    <div className="text-[10px] mt-1 opacity-75">{role.id}</div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">灵魂角色</label>
              <select
                value={form.defaultSoulRoleId}
                onChange={(event) => setField('defaultSoulRoleId', event.target.value as RoleId)}
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {form.roleIds.map((roleId) => (
                  <option key={roleId} value={roleId}>
                    {ROLE_OPTIONS.find((item) => item.id === roleId)?.label || roleId}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">状态</label>
              <select
                value={form.status}
                onChange={(event) => setField('status', event.target.value as RoleSetStatus)}
                className="w-full bg-surface-muted border border-border-subtle rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-border-subtle flex items-center justify-between">
            <p className="text-xs text-slate-500">
              保存后，新建项目弹窗会自动使用最新行业角色集。
            </p>
            <div className="flex items-center gap-3">
              {!isCreateMode && selectedItem && (
                <button
                  onClick={() => startEdit(selectedItem)}
                  className="px-3 py-2 rounded-lg border border-border-subtle text-slate-300 hover:bg-white/10 text-xs font-semibold flex items-center gap-2"
                >
                  <Pencil size={14} />
                  重置
                </button>
              )}
              <button
                onClick={isCreateMode ? () => void handleCreate() : () => void handleUpdate()}
                disabled={saving || loading}
                className="px-4 py-2 rounded-lg bg-primary text-surface text-sm font-semibold hover:bg-primary/90 disabled:opacity-60"
              >
                {saving ? '保存中...' : isCreateMode ? '创建行业角色集' : '保存修改'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </SurfaceModal>
  );
}

