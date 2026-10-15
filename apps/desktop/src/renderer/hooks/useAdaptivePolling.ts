import { useEffect, useRef } from 'react'

type AdaptivePollingOptions = {
  hasActiveAccounts: boolean
  refreshDispatch: () => void
  refreshLearning: () => void
}

export function useAdaptivePolling(options: AdaptivePollingOptions) {
  const optionsRef = useRef(options)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    let pollingSeq = 0
    const pollingTimer = window.setInterval(() => {
      pollingSeq += 1
      const current = optionsRef.current
      const dispatchEvery = current.hasActiveAccounts ? 1 : 3
      const learningEvery = current.hasActiveAccounts ? 3 : 5

      if (pollingSeq % dispatchEvery === 0) current.refreshDispatch()
      if (pollingSeq % learningEvery === 0) current.refreshLearning()
    }, 3000)

    return () => {
      window.clearInterval(pollingTimer)
    }
  }, [])
}
