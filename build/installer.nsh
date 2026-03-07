!macro customInit
  DetailPrint "[nsis] pre-cleanup: try to stop old running processes"
  nsExec::Exec 'taskkill /F /T /IM "抖音福袋助手.exe"'
  nsExec::Exec 'taskkill /F /T /IM "douyin-lottery-assistant.exe"'
  nsExec::Exec 'taskkill /F /T /IM "Uninstall 抖音福袋助手.exe"'
  nsExec::Exec 'taskkill /F /T /IM "Uninstall douyin-lottery-assistant.exe"'
!macroend
