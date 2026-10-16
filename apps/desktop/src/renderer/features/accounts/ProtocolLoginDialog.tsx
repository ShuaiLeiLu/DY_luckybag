import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from 'antd'

type LoginSnapshot = {
  attemptId?: string; state: string; expiresAt?: number; qrImage?: string; mode?: 'qr' | 'sms'
  error?: { message: string; code: string; businessCode?: number }
  account?: { id: string; nickname: string }
}
const terminal = new Set(['completed', 'failed', 'expired', 'canceled'])
const labels: Record<string, string> = { idle: '准备登录', registering: '正在注册安卓协议设备…',
  requesting_qr: '正在获取登录二维码…', waiting: '请用抖音 App 扫描二维码', scanned: '已扫码，请在手机上确认登录',
  waiting_mobile: '请输入手机号发送验证码', waiting_code: '验证码已发送，请输入收到的验证码',
  verifying: '正在校验账号身份…', saving: '正在加密保存会话…', completed: '登录成功，会话已自动保存',
  failed: '登录未完成', expired: '二维码已过期', canceled: '登录已取消' }

export function ProtocolLoginDialog({ accountId, onClose }: { accountId?: string; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<LoginSnapshot>({ state: 'idle' })
  const [remaining, setRemaining] = useState(0)
  const [generation, setGeneration] = useState(0)
  const [mobile, setMobile] = useState('')
  const [code, setCode] = useState('')
  const attemptRef = useRef('')
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let ownedAttempt = ''
    const update = (next: LoginSnapshot) => {
      if (!disposed) { setSnapshot(next); setRemaining(Math.max(0, Math.ceil(((next.expiresAt || 0) - Date.now()) / 1000))) }
    }
    const localFailure = (message: string) => update({ state: 'failed', error: { code: 'LOGIN_LOCAL_ERROR', message } })
    const poll = async () => {
      try {
        const next = await window.electronAPI.invoke('protocol:login-status', { attemptId: ownedAttempt })
        if (disposed) return
        if (!next.success) { localFailure('登录流程已结束，请重新发起登录。'); return }
        update(next)
        if (!terminal.has(next.state)) timer = setTimeout(() => void poll(), 500)
      } catch { if (!disposed) localFailure('无法读取登录状态，请重新发起登录。') }
    }
    update({ state: 'registering' })
    void (async () => {
      try {
        const result = await window.electronAPI.invoke('protocol:login-start', { accountId })
        ownedAttempt = result.attemptId || ''
        if (disposed) { if (ownedAttempt) void window.electronAPI.invoke('protocol:login-cancel', { attemptId: ownedAttempt }); return }
        attemptRef.current = ownedAttempt
        if (!result.success) { localFailure(typeof result.error === 'string' ? result.error : '登录初始化失败，请重试。'); return }
        update(result)
        if (!terminal.has(result.state)) timer = setTimeout(() => void poll(), 500)
      } catch { if (!disposed) localFailure('登录初始化失败，请重试。') }
    })()
    return () => {
      disposed = true; clearTimeout(timer)
      if (ownedAttempt) void window.electronAPI.invoke('protocol:login-cancel', { attemptId: ownedAttempt }).catch(() => {})
    }
  }, [accountId, generation])
  const close = async () => {
    if (attemptRef.current) await window.electronAPI.invoke('protocol:login-cancel', { attemptId: attemptRef.current }).catch(() => {})
    onClose()
  }
  // One shared submission path for both SMS steps: the service routes by state.
  const submit = async (payload: { mobile?: string; code?: string }) => {
    try {
      const next = await window.electronAPI.invoke('protocol:login-submit', { attemptId: attemptRef.current, ...payload })
      if (next.success) {
        setSnapshot(next); setRemaining(Math.max(0, Math.ceil(((next.expiresAt || 0) - Date.now()) / 1000)))
      } else if (next.error) {
        setSnapshot(current => ({ ...current, state: 'failed', error: typeof next.error === 'string'
          ? { code: next.code || 'LOGIN_LOCAL_ERROR', message: next.error } : next.error }))
      }
    } catch { /* The next status poll reports the state. */ }
  }
  const smsStep = snapshot.mode === 'sms' ? snapshot.state : ''
  return <Modal title={accountId ? '重新登录' : '添加账号 · 安卓协议登录'} open footer={null}
    onCancel={() => void close()} mask={{ closable: false }} destroyOnHidden>
    <div className="space-y-4">
      <p className="text-sm text-slate-400">使用手机验证码登录抖音。成功后会自动加密保存会话和设备参数。</p>
      <div className="min-h-64 flex flex-col items-center justify-center gap-4" aria-live="polite">
        {snapshot.qrImage && <img src={snapshot.qrImage} alt="抖音安卓协议登录二维码" width={224} height={224}
          className="rounded-lg bg-white p-3" />}
        <p className="font-medium" role="status">{labels[snapshot.state] || '等待登录状态'}</p>
        {['waiting', 'scanned', 'waiting_mobile', 'waiting_code'].includes(snapshot.state) &&
          <p className="text-sm text-slate-400">剩余 {remaining} 秒</p>}
        {smsStep === 'waiting_mobile' && <div className="w-full max-w-xs space-y-2">
          <Input id="protocol-sms-mobile" placeholder="手机号" value={mobile} allowClear
            onChange={event => setMobile(event.target.value)} onPressEnter={() => void submit({ mobile })} />
          <Button type="primary" block disabled={!mobile.trim()} onClick={() => void submit({ mobile })}>发送验证码</Button>
        </div>}
        {smsStep === 'waiting_code' && <div className="w-full max-w-xs space-y-2">
          <Input id="protocol-sms-code" placeholder="短信验证码" value={code} allowClear
            onChange={event => setCode(event.target.value)} onPressEnter={() => void submit({ code })} />
          <Button type="primary" block disabled={!code.trim()} onClick={() => void submit({ code })}>提交验证码</Button>
        </div>}
        {snapshot.error && <div role="alert" className="rounded border border-amber-700 bg-amber-950/20 p-3 text-sm">
          <p>{snapshot.error.message}</p>
          <p className="mt-2 text-xs text-slate-400">{snapshot.error.code}{snapshot.error.businessCode !== undefined ? ` · 业务码 ${snapshot.error.businessCode}` : ''}</p>
        </div>}
        {snapshot.state === 'completed' && <p>{snapshot.account?.nickname} 已添加。可以继续验证目标福袋详情。</p>}
      </div>
      <div className="flex justify-end gap-2">
        {['failed', 'expired', 'canceled'].includes(snapshot.state) &&
          <Button type="primary" onClick={() => setGeneration(value => value + 1)}>重新登录</Button>}
        <Button onClick={() => void close()}>{snapshot.state === 'completed' ? '完成' : '取消登录'}</Button>
      </div>
    </div>
  </Modal>
}
