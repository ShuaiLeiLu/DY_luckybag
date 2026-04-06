import React, { ReactNode } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Settings, 
  ShieldCheck, 
  History,
  Activity
} from 'lucide-react';

interface MainLayoutProps {
  children: ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
  title: string;
}

export function MainLayout({ children, activeTab, onTabChange, title }: MainLayoutProps) {
  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: '工作台' },
    { id: 'accounts', icon: Users, label: '账户管理' },
    { id: 'history', icon: History, label: '历史记录' },
    { id: 'settings', icon: Settings, label: '设置中心' },
    { id: 'license', icon: ShieldCheck, label: '授权状态' },
  ];

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-slate-200 selection:bg-blue-500/30 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800/50 bg-[#0f0f0f] flex flex-col shrink-0">
        <div className="p-6">
          <div className="flex items-center gap-3 px-2 mb-8">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-100">抖娃福袋助手</span>
          </div>

          <nav className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group
                    ${isActive 
                      ? 'bg-blue-600/10 text-blue-400 ring-1 ring-blue-500/20 shadow-[0_0_15px_-3px_rgba(59,130,246,0.1)]' 
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}
                  `}
                >
                  <Icon className={`h-5 w-5 transition-colors ${isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto p-6">
          <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800/50 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">运行状态</span>
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">系统服务已连接，正在监控中...</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-radial-gradient from-slate-900/20 to-transparent">
        <header className="h-16 border-b border-slate-800/50 flex items-center justify-between px-8 bg-[#0f0f0f]/50 backdrop-blur-md sticky top-0 z-10">
          <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
          <div className="flex items-center gap-4">
             {/* Optional: Add search or global actions here */}
             <div className="px-3 py-1.5 rounded-lg bg-slate-800/50 text-[10px] text-slate-400 font-mono border border-slate-700/30">
               v3.0.0 Stable
             </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
