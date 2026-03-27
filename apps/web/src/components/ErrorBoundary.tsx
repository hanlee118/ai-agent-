import React, { type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  message?: string;
};

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || '未知错误' };
  }

  componentDidCatch(error: Error) {
    console.error('App ErrorBoundary caught an error:', error);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-full bg-surface flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-surface-soft border border-border-subtle rounded-2xl p-6 text-center space-y-4 shadow-xl">
            <div className="mx-auto w-12 h-12 rounded-xl bg-danger/10 flex items-center justify-center text-danger">
              <AlertCircle size={24} />
            </div>
            <h2 className="text-lg font-bold text-white">界面发生异常</h2>
            <p className="text-sm text-slate-400 break-all">
              {this.state.message || '组件渲染失败，请重试。'}
            </p>
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-4 py-2 rounded-xl bg-primary text-surface font-semibold hover:bg-primary/90 transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
