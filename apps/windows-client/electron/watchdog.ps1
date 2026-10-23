# Relaunches Pisonet Timer if the customer force-ends or suspends it.
# Runs detached from the app. Exits when the kiosk-run marker is removed
# (maintenance quit or PC shutdown).
param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$MarkerPath,
  [Parameter(Mandatory = $true)][string]$PidPath
)

$ErrorActionPreference = 'SilentlyContinue'
Set-Content -LiteralPath $PidPath -Value $PID -Encoding ascii

$imageName = [System.IO.Path]::GetFileNameWithoutExtension($ExePath)

# NtSuspendProcess / Resource Monitor "Suspend" freezes the timer UI while the
# process still appears in Get-Process. Without this check the countdown looks
# paused and the customer keeps a free unlocked desktop.
function Test-FullySuspended([System.Diagnostics.Process]$proc) {
  try {
    $null = $proc.Refresh()
    $threads = @($proc.Threads)
    if ($threads.Count -eq 0) { return $false }
    $suspended = @($threads | Where-Object { $_.WaitReason -eq 'Suspended' })
    return ($suspended.Count -eq $threads.Count)
  } catch {
    return $false
  }
}

while (Test-Path -LiteralPath $MarkerPath) {
  $running = @(Get-Process -Name $imageName -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -eq $ExePath -or -not $_.Path
  })

  foreach ($proc in $running) {
    if (Test-FullySuspended $proc) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
  }

  $running = @(Get-Process -Name $imageName -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -eq $ExePath -or -not $_.Path
  })

  if ($running.Count -eq 0 -and (Test-Path -LiteralPath $MarkerPath)) {
    Start-Process -FilePath $ExePath | Out-Null
  }

  Start-Sleep -Seconds 2
}

Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
