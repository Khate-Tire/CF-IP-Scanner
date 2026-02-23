; Custom NSIS script to add Windows Firewall exception for backend.exe
; This runs during installation (already has admin privileges)

!macro customInstall
  ; Add firewall rule for the backend process
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Antigravity Scanner Backend"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Antigravity Scanner Backend" dir=in action=allow program="$INSTDIR\resources\backend.exe" enable=yes profile=any'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Antigravity Scanner Backend Out" dir=out action=allow program="$INSTDIR\resources\backend.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  ; Clean up firewall rules on uninstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Antigravity Scanner Backend"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Antigravity Scanner Backend Out"'
!macroend
