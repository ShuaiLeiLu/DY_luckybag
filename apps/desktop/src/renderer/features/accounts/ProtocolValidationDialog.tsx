import { useEffect, useState } from 'react'
import { Button, Input, Modal } from 'antd'

type Report = {
  authentication: { status: string; code?: string; userId?: string; statusCode?: number }
  signature: { status: string; note?: string }
  details: { status: string; code?: string; statusCode?: number; lotteryId?: string; lotteryDetail?: Record<string, any> }
}
const statuses: Record<string, string> = { not_tested: '未验证', local_only: '仅确认本地凭据存在', unverified: '尚未验证平台接受',
  verified: '已由真实接口确认', failed: '验证失败', inconclusive: '响应不足以确认', accepted_for_read_requests: '本次读取请求已接受' }
export function ProtocolValidationDialog({ accountId, onClose, onLogin }: {
  accountId: string; onClose: () => void; onLogin: (accountId: string) => Promise<void>
}) {
  const [roomId, setRoomId] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setReport(null); setRoomId(''); setError('') }, [accountId])
  const verify = async () => {
    if (!/^[0-9]{1,32}$/.test(roomId)) { setError('请输入数字 room_id；它与直播间短号不同。'); return }
    setBusy(true); setError(''); setReport(null)
    try {
      const result = await window.electronAPI.invoke('protocol:verify', { accountId, roomId })
      if (!result?.authentication) throw new Error(result?.error || '协议验证未完成')
      setReport(result)
    } catch (err) { setError((err as Error).message || '协议验证未完成') }
    finally { setBusy(false) }
  }
  return <Modal title={`安卓协议验证 · ${accountId}`} open={Boolean(accountId)} onCancel={busy ? undefined : onClose}
    closable={!busy} maskClosable={!busy} footer={null}>
    <div className="space-y-4">
      <p>依次核验当前账号身份和目标福袋详情。验证不会提交参与请求。</p>
      <div>
        <label htmlFor="protocol-room-id">目标直播间 room_id</label>
        <Input id="protocol-room-id" value={roomId} disabled={busy} onChange={event => setRoomId(event.target.value.trim())}
          placeholder="填写正在发放福袋的房间内部数字 ID" aria-invalid={Boolean(error)} aria-describedby="protocol-validation-error" />
      </div>
      {error && <p id="protocol-validation-error" role="alert" className="text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="primary" loading={busy} onClick={() => void verify()}>验证登录态与福袋详情</Button>
        <Button disabled={busy} onClick={() => void onLogin(accountId)}>重新扫码登录</Button>
      </div>
      <div aria-live="polite">
        {busy && <p>正在验证，最多执行两次读取请求，请稍候…</p>}
        {report && <div className="space-y-3">
          {([['登录态', report.authentication], ['签名', report.signature], ['福袋详情', report.details]] as const).map(([title, item]) =>
            <div key={title} className="rounded border border-slate-700 p-3">
              <div className="font-semibold">{title}：{statuses[item.status] || item.status}</div>
              {'code' in item && item.code && <div className="font-mono text-xs">{item.code}{'statusCode' in item && item.statusCode ? ` · HTTP ${item.statusCode}` : ''}</div>}
            </div>)}
          {report.signature.note && <p className="text-xs text-slate-400">{report.signature.note}</p>}
          {report.details.lotteryId && <p>福袋 ID：{report.details.lotteryId} · {report.details.lotteryDetail?.lotteryName || '未命名奖品'}</p>}
        </div>}
      </div>
    </div>
  </Modal>
}
