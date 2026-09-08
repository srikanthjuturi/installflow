# Export a built .docx to PDF through Word, so the client gets a file that
# renders identically everywhere and needs no Office to read.
#
#   powershell -File build/export_pdf.ps1 -Docx "dist\... .docx"
#
# It opens read-only and never saves the source document.

param(
  [Parameter(Mandatory = $true)][string]$Docx,
  [string]$Pdf
)

$ErrorActionPreference = 'Stop'

$docxPath = (Resolve-Path $Docx).Path
if (-not $Pdf) { $Pdf = [System.IO.Path]::ChangeExtension($docxPath, '.pdf') }
if (-not [System.IO.Path]::IsPathRooted($Pdf)) { $Pdf = Join-Path (Get-Location) $Pdf }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  # ReadOnly, AddToRecentFiles off — this is a build step, not somebody editing.
  $doc = $word.Documents.Open($docxPath, $false, $true)
  try {
    # 17 = wdFormatPDF
    $doc.SaveAs([ref]$Pdf, [ref]17)
    Write-Output "exported $([System.IO.Path]::GetFileName($Pdf)) ($($doc.ComputeStatistics(2)) pages)"
  }
  finally { $doc.Close([ref]$false) }
}
finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
