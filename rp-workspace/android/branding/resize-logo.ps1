# logo 资源生成：SVG 渲染图 → Android 各 dpi 资源（PowerShell + System.Drawing）
# 用法：pwsh tmp/resize-logo.ps1
Add-Type -AssemblyName System.Drawing

$res = 'd:\DSH RolePlay\rp-workspace\android\app\src\main\res'
$full = [System.Drawing.Image]::FromFile('d:\DSH RolePlay\tmp\logo-full-v2.png')
$bg   = [System.Drawing.Image]::FromFile('d:\DSH RolePlay\tmp\logo-bg.png')
$fg   = [System.Drawing.Image]::FromFile('d:\DSH RolePlay\tmp\logo-fg.png')

# adaptive icon 前景/背景层尺寸（dp→px 基准：mdpi=108）
$adaptive = @{ 'mdpi' = 108; 'hdpi' = 162; 'xhdpi' = 216; 'xxhdpi' = 324; 'xxxhdpi' = 432 }
# legacy 启动图尺寸
$legacy = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }

function Resize-Image($src, $width, $outPath) {
    $bmp = New-Object System.Drawing.Bitmap $width, $width
    $bmp.SetResolution(72, 72)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, 0, 0, $width, $width)
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

foreach ($dpi in $adaptive.Keys) {
    $dir = Join-Path $res "mipmap-$dpi"
    Resize-Image $bg $adaptive[$dpi] (Join-Path $dir 'ic_launcher_background.png')
    Resize-Image $fg $adaptive[$dpi] (Join-Path $dir 'ic_launcher_foreground.png')
    Write-Output "adaptive $dpi -> $($adaptive[$dpi])px"
}
foreach ($dpi in $legacy.Keys) {
    $dir = Join-Path $res "mipmap-$dpi"
    Resize-Image $full $legacy[$dpi] (Join-Path $dir 'ic_launcher.png')
    Write-Output "legacy $dpi -> $($legacy[$dpi])px"
}
$full.Dispose(); $bg.Dispose(); $fg.Dispose()
Write-Output '完成：13 个资源文件已重写'