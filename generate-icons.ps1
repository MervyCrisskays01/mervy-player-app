# Génère les icônes PWA MervyPlayer (sans lettre "M" — pictogramme musique)
Add-Type -AssemblyName System.Drawing

function New-MervyIcon($size, $outputPath) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Fond dégradé violet → rose
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 124, 58, 237),
        [System.Drawing.Color]::FromArgb(255, 236, 72, 153),
        135
    )
    $g.FillRectangle($brush, 0, 0, $size, $size)

    # Cercle lumineux central
    $innerSize = [int]($size * 0.72)
    $innerX = [int](($size - $innerSize) / 2)
    $innerY = [int](($size - $innerSize) / 2)
    $innerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(55, 255, 255, 255))
    $g.FillEllipse($innerBrush, $innerX, $innerY, $innerSize, $innerSize)

    # Note de musique blanche (pas de texte "M")
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $noteR = [int]($size * 0.11)
    $cx = [int]($size * 0.36)
    $cy = [int]($size * 0.58)
    $g.FillEllipse($white, $cx - $noteR, $cy - $noteR, $noteR * 2, $noteR * 2)

    $stemW = [int]($size * 0.045)
    $stemH = [int]($size * 0.32)
    $stemX = $cx + $noteR - [int]($stemW / 2)
    $stemY = $cy - $noteR - $stemH + [int]($size * 0.04)
    $g.FillRectangle($white, $stemX, $stemY, $stemW, $stemH)

    # Tête de la note (petit drapeau)
    $flagW = [int]($size * 0.14)
    $flagH = [int]($size * 0.09)
    $g.FillEllipse($white, $stemX + $stemW - 2, $stemY, $flagW, $flagH)

    # Accent cyan (comme l'icône actuelle)
    $accentR = [int]($size * 0.075)
    $accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 6, 182, 212))
    $g.FillEllipse($accentBrush, [int]($size * 0.68), [int]($size * 0.14), $accentR * 2, $accentR * 2)

    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    $brush.Dispose()
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
New-MervyIcon 180 (Join-Path $root "icon-180.png")
New-MervyIcon 192 (Join-Path $root "icon-192.png")
New-MervyIcon 512 (Join-Path $root "icon-512.png")
Write-Host "Icones generees : icon-180.png, icon-192.png, icon-512.png"
