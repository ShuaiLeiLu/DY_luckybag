import { useEffect } from 'react'
import type { AccountSession } from '@shared/models'

type AccountSelectionOptions = {
  accounts: AccountSession[]
  selectedAccountId: string
  onSelectedAccountIdChange: (value: string) => void
}

export function useAccountSelection(options: AccountSelectionOptions) {
  const { accounts, selectedAccountId, onSelectedAccountIdChange } = options

  useEffect(() => {
    if (!accounts.length) {
      if (selectedAccountId) onSelectedAccountIdChange('')
      return
    }

    if (!selectedAccountId || !accounts.some((account) => account.id === selectedAccountId)) {
      onSelectedAccountIdChange(accounts[0].id)
    }
  }, [accounts, selectedAccountId, onSelectedAccountIdChange])
}
