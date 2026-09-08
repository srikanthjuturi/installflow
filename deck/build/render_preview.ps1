# Render a built deck's slides to PNG so they can be eyeballed without opening
# PowerPoint by hand. Verification only — it never saves the presentation.
#
#   powershell -File build/render_preview.ps1 -Deck "dist\... .pptx" -Out "out\preview"

param(
  [Parameter(Mandatory = $true)][string]$Deck,
  [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = 'Stop'

$deckPath = (Resolve-Path $Deck).Path
if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }
$outPath = (Resolve-Path $Out).Path

Get-ChildItem $outPath -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force

$ppt = New-Object -ComObject PowerPoint.Application
try {
  # 2 = msoFalse. PowerPoint refuses to be fully invisible, but it opens
  # without a window and closes again.
  $pres = $ppt.Presentations.Open($deckPath, $true, $false, $false)
  try {
    $index = 1
    foreach ($slide in $pres.Slides) {
      $name = 'slide-{0:d2}.png' -f $index
      $slide.Export((Join-Path $outPath $name), 'PNG', 1600, 900)
      $index++
    }
    Write-Output "exported $($pres.Slides.Count) slide(s) to $outPath"
  }
  finally { $pres.Close() }
}
finally {
  $ppt.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
