# scripts/render-variant-images.ps1
# ---------------------------------------------------------------
# Конвертирует EMF/WMF картинки задач из docx → PNG для Storage.
#
# Триггер: новый вариант пробника (вариант 3, 4, ...) от Егора.
# Docx содержит математические рисунки как Enhanced Metafile (EMF) или
# Windows Metafile (WMF) — векторные форматы Microsoft. Браузеры их НЕ
# рендерят, поэтому нужно конвертировать в PNG до загрузки в Storage.
#
# Этот скрипт использует .NET GDI+ (нативная поддержка EMF/WMF в Windows)
# с antialiasing + 4x scale. Альтернатива LibreOffice / ImageMagick — не
# требует установки.
#
# Использование:
#   pwsh scripts/render-variant-images.ps1 `
#     -DocxPath  "docs/delivery/features/mock-exams-v1/source/Тр_вариант 3.docx" `
#     -OutDir    "docs/delivery/features/mock-exams-v1/source/variant3"
#
# По умолчанию рендерит ВСЕ EMF/WMF из docx. Опционально --OnlyNames для
# выборочного рендера (e.g. "image8,image10,image20" — пересборка после
# обнаружения проблемных файлов).
#
# Output: PNG файлы по basename из docx. Pure white background, 4x scale,
# HighQuality antialiasing. Path traversal-safe — пишет только в OutDir.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DocxPath,

  [Parameter(Mandatory = $true)]
  [string]$OutDir,

  [Parameter(Mandatory = $false)]
  [string]$OnlyNames = "",

  [Parameter(Mandatory = $false)]
  [int]$Scale = 4
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# Validate inputs
if (-not (Test-Path $DocxPath)) {
  throw "Docx не найден: $DocxPath"
}
if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  Write-Host "Создал OutDir: $OutDir"
}

# Unpack docx (it's a zip) into temp dir
$tmpRoot = Join-Path $env:TEMP ("docx-render-" + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
Write-Host "Распаковываю docx в: $tmpRoot"

try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($DocxPath, $tmpRoot)
  $mediaDir = Join-Path $tmpRoot "word\media"
  if (-not (Test-Path $mediaDir)) {
    throw "В docx нет папки word/media — это не Word-документ или пуст"
  }

  # Collect EMF/WMF candidates
  $allMedia = Get-ChildItem -Path $mediaDir -File
  $vectorFiles = $allMedia | Where-Object { $_.Extension -in @('.emf', '.wmf') }

  $onlyNamesSet = $null
  if ($OnlyNames) {
    $onlyNamesSet = @($OnlyNames -split '[,;\s]+' | Where-Object { $_ -ne '' })
    Write-Host "Фильтр: только $($onlyNamesSet -join ', ')"
  }

  Write-Host "Найдено EMF/WMF: $($vectorFiles.Count) файлов"
  $rendered = 0
  $skipped = 0
  foreach ($vec in $vectorFiles) {
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($vec.Name)
    if ($onlyNamesSet -and ($onlyNamesSet -notcontains $baseName)) {
      $skipped++
      continue
    }

    $dst = Join-Path $OutDir "$baseName.png"
    $oldSize = if (Test-Path $dst) { (Get-Item $dst).Length } else { 0 }

    $emf = [System.Drawing.Image]::FromFile($vec.FullName)
    try {
      $w = [int]($emf.Width * $Scale)
      $h = [int]($emf.Height * $Scale)
      $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try {
        $bmp.SetResolution(96 * $Scale, 96 * $Scale)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
          $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
          $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $g.Clear([System.Drawing.Color]::White)
          $g.DrawImage($emf, 0, 0, $w, $h)
        }
        finally { $g.Dispose() }
        $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
      }
      finally { $bmp.Dispose() }
    }
    finally { $emf.Dispose() }

    $newSize = (Get-Item $dst).Length
    $sizeDelta = if ($oldSize -gt 0) { "$oldSize -> $newSize bytes" } else { "$newSize bytes (new)" }
    Write-Host "✓ $baseName.png  ($($w)x$($h) px, $sizeDelta)"
    $rendered++
  }

  Write-Host ""
  Write-Host "Готово: $rendered отрендерено, $skipped пропущено."
}
finally {
  if (Test-Path $tmpRoot) {
    Remove-Item -Recurse -Force $tmpRoot
  }
}

Write-Host ""
Write-Host "Следующий шаг: визуально проверь PNG в $OutDir,"
Write-Host "затем загрузи в Lovable Storage bucket mock-exam-variant-tasks/<variantN>/."
