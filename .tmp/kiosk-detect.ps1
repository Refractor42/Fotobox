$p = @(Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -and $_.CommandLine.Contains('SnapBoxKiosk') })
Write-Output ('COUNT=' + $p.Count)
if ($p.Count -gt 0) { exit 0 }
exit 1
