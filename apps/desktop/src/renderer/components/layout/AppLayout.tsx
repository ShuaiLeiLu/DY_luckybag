import type { ReactNode } from 'react'
import { Layout } from 'antd'

interface AppLayoutProps {
  sider: ReactNode
  header: ReactNode
  children: ReactNode
}

export function AppLayout({ sider, header, children }: AppLayoutProps) {
  return (
    <Layout className="h-screen w-screen overflow-hidden bg-slate-950">
      <Layout.Sider width={220} className="border-r border-slate-800/80 bg-slate-950">
        {sider}
      </Layout.Sider>
      <Layout className="flex flex-col overflow-hidden bg-slate-950">
        {header}
        <Layout.Content className="flex-1 overflow-auto bg-[#080d1a] p-4 sm:p-5">
          {children}
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
