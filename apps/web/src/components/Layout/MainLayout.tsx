import type { ReactNode } from 'react';

type MainLayoutProps = {
  sidebar: ReactNode;
  topbar?: ReactNode;
  children: ReactNode;
  overlays?: ReactNode;
};

export default function MainLayout({ sidebar, topbar, children, overlays }: MainLayoutProps) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface text-slate-200 font-sans antialiased">
      {sidebar}
      <div className="flex-1 flex flex-col min-w-0 bg-surface relative">
        {topbar}
        <div className="flex-1 overflow-auto scrollbar-hide">
          {children}
        </div>
        {overlays}
      </div>
    </div>
  );
}
