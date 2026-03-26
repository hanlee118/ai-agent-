import { useState } from "react";
import type { AuthStatus } from "@occ/shared";
import { Lock, Terminal } from "lucide-react";
import { api } from "../lib/api";
import { useLocale } from "../lib/locale";

export function AuthPage({
  authStatus,
  onAuthenticated
}: {
  authStatus: AuthStatus;
  onAuthenticated: (status: AuthStatus) => void;
}) {
  const { isEnglish } = useLocale();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSetup = !authStatus.setupComplete;
  const copy = isEnglish
    ? {
        eyebrow: "OpenClaw Secure Entry",
        setupTitle: "Create Admin Access",
        loginTitle: "Sign In",
        setupCopy: "Create the local admin password first. All control-plane actions will require authentication afterwards.",
        loginCopy: "Enter the administrator password to access the workbench.",
        accessLevel: "Level 4 Access",
        passwordTooShort: "Password must be at least 8 characters.",
        passwordMismatch: "Passwords do not match.",
        authFailed: "Authentication failed",
        passwordLabel: isSetup ? "Create Password" : "Admin Password",
        confirmLabel: "Confirm Password",
        placeholder: "At least 8 characters",
        confirmPlaceholder: "Repeat the password",
        busy: "Processing...",
        setupButton: "Initialize and Continue",
        loginButton: "Sign In"
      }
    : {
        eyebrow: "OpenClaw Secure Entry",
        setupTitle: "初始化管理员账号",
        loginTitle: "登录工作台",
        setupCopy: "首次启动需要先设置本地管理员密码，后续所有系统操作都将经过登录鉴权。",
        loginCopy: "请输入管理员密码以进入工作台。",
        accessLevel: "四级指挥权限",
        passwordTooShort: "密码至少需要 8 位。",
        passwordMismatch: "两次输入的密码不一致。",
        authFailed: "认证失败",
        passwordLabel: isSetup ? "设置密码" : "管理员密码",
        confirmLabel: "确认密码",
        placeholder: "至少 8 位",
        confirmPlaceholder: "再次输入密码",
        busy: "处理中...",
        setupButton: "完成初始化并进入系统",
        loginButton: "登录"
      };

  async function handleSubmit() {
    setError(null);

    if (password.length < 8) {
      setError(copy.passwordTooShort);
      return;
    }

    if (isSetup && password !== confirmPassword) {
      setError(copy.passwordMismatch);
      return;
    }

    setBusy(true);
    try {
      const nextStatus = isSetup
        ? await api.setupAuth({ password })
        : await api.loginAuth({ password });
      onAuthenticated(nextStatus);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.authFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand-block">
          <div className="auth-brand-icon">
            <Terminal size={30} />
          </div>
          <div className="auth-brand-copy">
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1>{isSetup ? copy.setupTitle : copy.loginTitle}</h1>
            <p className="hero-copy">
              {isSetup ? copy.setupCopy : copy.loginCopy}
            </p>
            <span className="pill">{copy.accessLevel}</span>
          </div>
        </div>

        <div className="form-grid auth-form-grid">
          <label className="form-field">
            <span>{copy.passwordLabel}</span>
            <div className="auth-input-wrap">
              <Lock size={16} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={copy.placeholder}
              />
            </div>
          </label>

          {isSetup ? (
            <label className="form-field">
              <span>{copy.confirmLabel}</span>
              <div className="auth-input-wrap">
                <Lock size={16} />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={copy.confirmPlaceholder}
                />
              </div>
            </label>
          ) : null}
        </div>

        {error ? <div className="flash-banner flash-error">{error}</div> : null}

        <div className="action-row action-row-wrap">
          <button className="button button-primary" onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? copy.busy : isSetup ? copy.setupButton : copy.loginButton}
          </button>
        </div>
      </section>
    </div>
  );
}
