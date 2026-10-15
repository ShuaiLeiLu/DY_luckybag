import { useEffect, useEffectEvent, useState } from 'react'
import { fetchDesktopNotice } from '../../services/poolClient'
import { emptyHotUpdate, emptyUpdate, type HotUpdateSnapshot } from '../lib/defaultSnapshots'
import type { UpdateSnapshot } from '@shared/models'

export function useDesktopUpdates(poolServerUrl: string) {
  const [announcementMarkdown, setAnnouncementMarkdown] = useState('')
  const [updateState, setUpdateState] = useState<UpdateSnapshot>(emptyUpdate)
  const [hotUpdateState, setHotUpdateState] = useState<HotUpdateSnapshot>(emptyHotUpdate)

  const refreshDesktopNotice = useEffectEvent(async () => {
    try {
      const result = await fetchDesktopNotice(poolServerUrl, { timeoutMs: 2600 }) as { ok?: boolean; data?: Record<string, unknown> }
      if (!result?.ok) {
        setAnnouncementMarkdown('')
        return
      }
      const payload = result.data || {}
      const text = String(payload.markdown ?? payload.noticeMarkdown ?? payload.notice ?? '').trim()
      setAnnouncementMarkdown(text)
    } catch {
      setAnnouncementMarkdown('')
    }
  })

  useEffect(() => {
    void refreshDesktopNotice()
  }, [poolServerUrl, refreshDesktopNotice])

  useEffect(() => {
    const offHotUpdate = window.electronAPI.desktop.onHotUpdateState((snapshot) => {
      setHotUpdateState((current) => ({
        ...current,
        ...snapshot
      }))
    })
    const offUpdate = window.electronAPI.desktop.onUpdateState((snapshot) => {
      setUpdateState((current) => ({
        ...current,
        ...snapshot
      }))
    })
    return () => {
      offHotUpdate()
      offUpdate()
    }
  }, [])

  return { announcementMarkdown, updateState, hotUpdateState, setUpdateState, setHotUpdateState }
}
