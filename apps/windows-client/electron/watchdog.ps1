# Relaunches Pisonet Timer if the customer force-ends it.
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

while (Test-Path -LiteralPath $MarkerPath) {
  $running = @(Get-Process -Name $imageName -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -eq $ExePath -or -not $_.Path
  })
  if ($running.Count -eq 0 -and (Test-Path -LiteralPath $MarkerPath)) {
    Start-Process -FilePath $ExePath | Out-Null
  }
  Start-Sleep -Seconds 2
}

Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
