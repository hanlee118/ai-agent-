import { useEffect, useState } from "react";
import type { OpenClawWorkspaceOverview, RuntimeSettings } from "@occ/shared";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

export function SettingsPage() {
  const { locale, setLocale, isEnglish } = useLocale();
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [workspace, setWorkspace] = useState<OpenClawWorkspaceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const copy = isEnglish
    ? {
        title: "Operator preferences and workspace defaults",
        hero: "This page centralizes UI preferences and operational defaults that shape how the workbench behaves for one commander.",
        language: "Language",
        workspaceRoot: "Workspace root",
        defaultProvider: "Default runtime provider",
        defaultModel: "Default runtime model",
        apiKey: "API key status",
        configured: "Configured",
        notConfigured: "Not configured"
      }
    : {
        title: "操作偏好与工作区默认设置",
        hero: "这一页集中管理当前指挥官的 UI 偏好与工作台默认配置，方便把平台真正当成长期工作环境来使用。",
        language: "语言",
        workspaceRoot: "工作区根目录",
        defaultProvider: "默认运行提供方",
        defaultModel: "默认运行模型",
        apiKey: "API Key 状态",
        configured: "已配置",
        notConfigured: "未配置"
      };

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      const [runtimeSettings, workspaceOverview] = await Promise.all([
        api.getRuntimeSettings(),
        api.getOpenClawWorkspace()
      ]);
      setSettings(runtimeSettings);
      setWorkspace(workspaceOverview);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="card">{isEnglish ? "Loading settings..." : "正在加载设置..."}</div>;
  }

  if (error) {
    return <div className="card error-text">{error}</div>;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>{copy.title}</h2>
          <p className="hero-copy">{copy.hero}</p>
        </div>
      </header>

      <section className="system-grid">
        <article className="card">
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.language}</p>
              <h3>{locale}</h3>
            </div>
          </div>
          <div className="segmented">
            <button className={locale === "zh-CN" ? "segmented-item is-active" : "segmented-item"} onClick={() => setLocale("zh-CN")}>
              中文
            </button>
            <button className={locale === "en-US" ? "segmented-item is-active" : "segmented-item"} onClick={() => setLocale("en-US")}>
              EN
            </button>
          </div>
        </article>

        <article className="card">
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.workspaceRoot}</p>
              <h3>{workspace?.rootPath}</h3>
            </div>
          </div>
          <div className="meta-strip meta-strip-compact">
            <div className="meta-chip">
              <span>{isEnglish ? "Projects" : "项目数"}</span>
              <strong>{workspace?.projects.length ?? 0}</strong>
            </div>
            <div className="meta-chip">
              <span>{isEnglish ? "Agents" : "Agent 数"}</span>
              <strong>{workspace?.agents.length ?? 0}</strong>
            </div>
            <div className="meta-chip">
              <span>{isEnglish ? "Sessions" : "会话数"}</span>
              <strong>{workspace?.totalSessions ?? 0}</strong>
            </div>
          </div>
        </article>

        <article className="card">
          <div className="section-header">
            <div>
              <p className="eyebrow">{copy.defaultProvider}</p>
              <h3>{settings?.provider}</h3>
            </div>
          </div>
          <div className="stack tight">
            <div className="meta-chip">
              <span>{copy.defaultModel}</span>
              <strong>{settings?.modelName || "-"}</strong>
            </div>
            <div className="meta-chip">
              <span>{copy.apiKey}</span>
              <strong>{settings?.apiKeyConfigured ? copy.configured : copy.notConfigured}</strong>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
