# Generates PNG app icons and the launcher .ico from simple vector shapes (matches app/public/icon.svg).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 512.0
  $dark = [System.Drawing.Color]::FromArgb(43, 42, 39)
  $paper = [System.Drawing.Color]::FromArgb(247, 245, 240)
  $gold = [System.Drawing.Color]::FromArgb(200, 161, 101)
  # Rounded square background
  $r = 96 * $s
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
  $path.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
  $path.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90)
  $path.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $dark), $path)
  # Page
  $page = New-Object System.Drawing.Drawing2D.GraphicsPath
  $page.AddLine(136 * $s, 120 * $s, 312 * $s, 120 * $s)
  $page.AddArc(248 * $s, 120 * $s, 128 * $s, 128 * $s, 270, 90)
  $page.AddLine(376 * $s, 184 * $s, 376 * $s, 392 * $s)
  $page.AddLine(376 * $s, 392 * $s, 200 * $s, 392 * $s)
  $page.AddArc(136 * $s, 264 * $s, 128 * $s, 128 * $s, 90, 90)
  $page.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush $paper), $page)
  # Lines of text
  $pen = New-Object System.Drawing.Pen $dark, ([Math]::Max(1, 18 * $s))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawLine($pen, 176 * $s, 180 * $s, 326 * $s, 180 * $s)
  $g.DrawLine($pen, 176 * $s, 230 * $s, 326 * $s, 230 * $s)
  $g.DrawLine($pen, 176 * $s, 280 * $s, 286 * $s, 280 * $s)
  # Pen nib
  $pts = @(
    (New-Object System.Drawing.PointF (330 * $s), (300 * $s)),
    (New-Object System.Drawing.PointF (390 * $s), (240 * $s)),
    (New-Object System.Drawing.PointF (418 * $s), (268 * $s)),
    (New-Object System.Drawing.PointF (358 * $s), (328 * $s)),
    (New-Object System.Drawing.PointF (330 * $s), (328 * $s))
  )
  $g.FillPolygon((New-Object System.Drawing.SolidBrush $gold), $pts)
  $g.Dispose()
  return $bmp
}

function Save-Png([int]$size, [string]$file) {
  $b = New-IconBitmap $size
  $b.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
}

Save-Png 192 (Join-Path $root 'app\public\icon-192.png')
Save-Png 512 (Join-Path $root 'app\public\icon-512.png')
Save-Png 180 (Join-Path $root 'app\public\apple-touch-icon.png')

# Multi-size .ico with PNG-compressed entries.
$sizes = 16, 24, 32, 48, 64, 128, 256
$images = foreach ($sz in $sizes) {
  $b = New-IconBitmap $sz
  $ms = New-Object System.IO.MemoryStream
  $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
  , $ms.ToArray()
}
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $sz = $sizes[$i]; $data = $images[$i]
  $w.Write([byte]($(if ($sz -ge 256) { 0 } else { $sz })))
  $w.Write([byte]($(if ($sz -ge 256) { 0 } else { $sz })))
  $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$data.Length); $w.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($data in $images) { $w.Write($data) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root 'launcher\AuthorDesk.ico'), $out.ToArray())
Write-Host 'Icons written.'
