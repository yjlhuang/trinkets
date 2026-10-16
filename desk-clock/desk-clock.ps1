# Desk Clock - 桌面指針時鐘 (Windows, PowerShell + WPF, 不需安裝任何東西)
#
# 功能:無邊框透明、永遠置頂、可拖曳、可調透明度/大小、游標移上去自動變透明、
#       可停用時鐘右鍵選單(讓右鍵穿透到桌面)、滑鼠穿透鎖定、
#       11 組配色 x 5 種邊框粗細 x 7 種金屬/木質邊框材質、日期用民國年、系統匣圖示。
# 操作:
#   左鍵按住拖曳 = 移動      滾輪 = 調透明度      Ctrl+滾輪 = 調大小
#   右鍵 = 時鐘選單(若已停用,右鍵會穿透到桌面;Ctrl+右鍵仍可叫出時鐘選單)
#   系統匣圖示按右鍵 = 同一份選單(永遠可用,滑鼠穿透鎖定時只能從這裡解除)
#   系統匣圖示雙擊 = 回到右上角並重新置頂
# 設定存在 %APPDATA%\desk-clock\settings.json;錯誤記錄在同資料夾的 error.log。
# 參數:-Reset  先刪除設定檔再啟動(時鐘不在執行中才有效,見 交接.md)
# 文件:使用指南.md(給一般使用者)、交接.md(給接手的人/LLM)、進度與展望.md
# 與 ClocX 老毛病的對策:
#   - 系統匣圖示用 NotifyIcon,Explorer 重啟後會自動補回圖示
#   - 每 20 秒重新宣告一次置頂,避免被別的置頂視窗悄悄壓到下面
#   - 單一執行個體,重複啟動不會疊出兩個

param([switch]$Reset)

$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:APPDATA 'desk-clock'
$cfgPath = Join-Path $dir 'settings.json'
$logPath = Join-Path $dir 'error.log'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
if ($Reset -and (Test-Path $cfgPath)) { Remove-Item $cfgPath -Force }

try {
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Windows.Forms, System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DcNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
public static class DcTex {
  static double H(int x, int y, int s) { unchecked { int n = x * 374761393 + y * 668265263 + s * 1274126177; n = (n ^ (n >> 13)) * 1274126177; n ^= n >> 16; return (n & 0x7fffffff) / (double)0x7fffffff; } }
  static double Noise(double x, double y, int s) {
    int xi = (int)Math.Floor(x), yi = (int)Math.Floor(y); double fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    double a = H(xi, yi, s), b = H(xi + 1, yi, s), c = H(xi, yi + 1, s), d = H(xi + 1, yi + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  static Color Lerp(Color a, Color b, double t) {
    t = Math.Max(0, Math.Min(1, t));
    return Color.FromArgb(255, (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
  }
  static Color C(string hex) { return ColorTranslator.FromHtml(hex); }
  // 400x400 貼圖對應 200x200 的時鐘畫布,中心在 (size/2,size/2);環形拉絲/環形木紋
  public static Bitmap Make(string kind, int size) {
    var bmp = new Bitmap(size, size);
    double cx = size / 2.0, k = size / 400.0;
    bool wood = kind == "walnut" || kind == "oak" || kind == "cherry";
    Color dark, mid, light;
    switch (kind) {
      case "gold":     dark = C("#6F4F0E"); mid = C("#D4A82C"); light = C("#FFF3B0"); break;
      case "bronze":   dark = C("#4F2A14"); mid = C("#B3683A"); light = C("#F2BE95"); break;
      case "gunmetal": dark = C("#14171B"); mid = C("#4A525C"); light = C("#9AA5B3"); break;
      case "walnut":   dark = C("#2E1A0E"); mid = C("#4F3019"); light = C("#7A4E2C"); break;
      case "oak":      dark = C("#A97C48"); mid = C("#CFA469"); light = C("#EBCB97"); break;
      case "cherry":   dark = C("#5A2214"); mid = C("#8E3F28"); light = C("#BD6B4C"); break;
      default:         dark = C("#535C66"); mid = C("#AEB6BF"); light = C("#FBFCFD"); break;  // chrome
    }
    for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) {
      double dx = x - cx, dy = y - cx, r = Math.Sqrt(dx * dx + dy * dy) / k, a = Math.Atan2(dy, dx);
      double t;
      if (wood) {
        // 木紋沿圓周方向連續延伸:徑向變化快、圓周方向變化慢(低頻),才不會變成編織狀
        double ca = Math.Cos(a), sa = Math.Sin(a);
        double warp = (Noise(ca * 1.6 + 20, sa * 1.6 + 20, 7) - 0.5) * 16 + (Noise(ca * 0.9 + r * 0.03, sa * 0.9, 3) - 0.5) * 7;
        double g = 0.5 + 0.5 * Math.Sin((r + warp) * 0.42);                      // 粗的年輪帶
        double g2 = 0.5 + 0.5 * Math.Sin((r + warp) * 1.7 + 1.3);               // 細年輪線
        double streak = Noise(ca * 2.2 + 50, r * 0.9 + sa * 2.2, 11);          // 細長的纖維紋
        double fiber = Noise(ca * 5 + 80, r * 2.6 + sa * 5, 19);               // 更細的纖維
        t = 0.40 * g + 0.22 * g2 + 0.24 * streak + 0.14 * fiber;
        t = (t - 0.5) * 1.5 + 0.5;
      } else {
        t = 0.5 + 0.30 * Math.Cos(2 * a - 0.9) + 0.20 * Math.Cos(a + 0.6) + 0.08 * Math.Cos(3 * a + 1.3);
        t += (Noise(r * 1.1, 3.3, 5) - 0.5) * 0.16;          // 環形拉絲
        t += (Noise(r * 6.0, a * 9, 8) - 0.5) * 0.05;
      }
      bmp.SetPixel(x, y, t < 0.5 ? Lerp(dark, mid, t * 2) : Lerp(mid, light, (t - 0.5) * 2));
    }
    return bmp;
  }
}
'@

# powershell.exe 沒有 DPI manifest,不宣告的話畫面會被 Windows 放大而變糊
try { [void][DcNative]::SetProcessDPIAware() } catch { }

# ---------- 單一執行個體 ----------
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\DeskClock-Doe-7f3a', [ref]$created)
if (-not $created) { exit }

# ---------- 設定 ----------
$cfg = @{
  size = 200; opacity = 0.9; topmost = $true; clickThrough = $false
  showDate = $true; showAmPm = $true; left = $null; top = $null
  theme = 'classic'; rim = 'normal'; frame = 'color'; dateStyle = 0
  hoverFade = $true; hoverOpacity = 0.25; rightMenu = $true
}
if (Test-Path $cfgPath) {
  try {
    $j = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($k in @($cfg.Keys)) { if ($null -ne $j.$k) { $cfg[$k] = $j.$k } }
  } catch { }
}
function Save-Cfg {
  try { ($cfg | ConvertTo-Json) | Set-Content -Path $cfgPath -Encoding UTF8 } catch { }
}

# ---------- 配色 ----------
# rim=邊框色  rim2=雙線外圈  faceC/faceE=錶面中心/邊緣漸層  tick=刻度  num=數字  text=日期與AM/PM  hand=時分針  sec=秒針
$themes = [ordered]@{
  classic  = @{ name = '經典藍';   rim = '#3A78C2'; rim2 = '#3A78C2'; faceC = '#FFFFFF'; faceE = '#E3EEFA'; tick = '#556070'; num = '#2F6FB5'; text = '#3C4350'; hand = '#1E2229'; sec = '#E02424' }
  midnight = @{ name = '午夜黑';   rim = '#2B2F36'; rim2 = '#8A94A6'; faceC = '#2A2E36'; faceE = '#14171C'; tick = '#8A94A6'; num = '#E6EAF2'; text = '#C9D0DC'; hand = '#F2F4F8'; sec = '#FF8A3D' }
  ocean    = @{ name = '深海藍';   rim = '#1B4F8A'; rim2 = '#5B9BD5'; faceC = '#1E3A5F'; faceE = '#0F2340'; tick = '#7FB2E5'; num = '#CFE6FF'; text = '#BFD8F2'; hand = '#FFFFFF'; sec = '#FFB020' }
  rosegold = @{ name = '玫瑰金';   rim = '#C98B86'; rim2 = '#E9C4BE'; faceC = '#FFF8F6'; faceE = '#F7E3DF'; tick = '#A8706B'; num = '#B5645E'; text = '#7A4F4B'; hand = '#5A3A38'; sec = '#D6336C' }
  forest   = @{ name = '森林綠';   rim = '#3F7D58'; rim2 = '#8FC1A2'; faceC = '#FFFFFF'; faceE = '#E1F0E6'; tick = '#4E6B5A'; num = '#2F6B47'; text = '#34493D'; hand = '#1F2D25'; sec = '#D9480F' }
  vintage  = @{ name = '復古棕';   rim = '#7A4E2D'; rim2 = '#C09A6B'; faceC = '#FFFDF5'; faceE = '#F6EEDA'; tick = '#6B4A2F'; num = '#6B3F1D'; text = '#5A4630'; hand = '#3B2412'; sec = '#B0281C' }
  silver   = @{ name = '金屬銀';   rim = '#9AA3AE'; rim2 = '#D5DAE0'; faceC = '#FFFFFF'; faceE = '#EEF0F3'; tick = '#6B7280'; num = '#4B5563'; text = '#4B5563'; hand = '#1F2937'; sec = '#E11D48' }
  sunset   = @{ name = '日落橘';   rim = '#F08A3C'; rim2 = '#FBC48F'; faceC = '#FFFDF8'; faceE = '#FFE9D2'; tick = '#A95F2A'; num = '#D9691F'; text = '#7A4A24'; hand = '#3D2A1B'; sec = '#C2255C' }
  lavender = @{ name = '薰衣草';   rim = '#7C6BC4'; rim2 = '#BDB2EA'; faceC = '#FFFFFF'; faceE = '#ECE8FA'; tick = '#6A5F9C'; num = '#6A56C0'; text = '#4A4468'; hand = '#2B2748'; sec = '#E0457B' }
  mint     = @{ name = '薄荷冰';   rim = '#2BAE9E'; rim2 = '#9EE0D6'; faceC = '#FFFFFF'; faceE = '#DDF5F1'; tick = '#3F7F77'; num = '#1F8E80'; text = '#2F5D57'; hand = '#173B37'; sec = '#F25F5C' }
  mono     = @{ name = '純黑白';   rim = '#111111'; rim2 = '#777777'; faceC = '#FFFFFF'; faceE = '#F2F2F2'; tick = '#222222'; num = '#111111'; text = '#222222'; hand = '#000000'; sec = '#D00000' }
}
$rims = [ordered]@{ none = '無邊框'; thin = '細邊'; normal = '標準'; thick = '粗邊'; double = '雙線' }
$frames = [ordered]@{ color = '純色(跟配色)'; chrome = '鉻銀'; gold = '金'; bronze = '古銅'; gunmetal = '槍灰'; walnut = '胡桃木'; oak = '橡木'; cherry = '櫻桃木' }
$dateStyles = @('115/10/16', '115年10月16日', '10月16日 週五')

# ---------- 小工具 ----------
$bc = New-Object System.Windows.Media.BrushConverter
function Br([string]$hex) { $b = $bc.ConvertFromString($hex); $b.Freeze(); $b }
function New-Line($x1, $y1, $x2, $y2, $brush, $th, $round) {
  $l = New-Object System.Windows.Shapes.Line
  $l.X1 = $x1; $l.Y1 = $y1; $l.X2 = $x2; $l.Y2 = $y2
  $l.Stroke = $brush; $l.StrokeThickness = $th
  if ($round) { $l.StrokeStartLineCap = 'Round'; $l.StrokeEndLineCap = 'Round' }
  $l
}
function New-Text($text, $left, $top, $w, $size, $brush, $bold, $family) {
  $t = New-Object System.Windows.Controls.TextBlock
  $t.Text = $text; $t.Width = $w; $t.TextAlignment = 'Center'
  $t.FontSize = $size; $t.Foreground = $brush; $t.FontFamily = New-Object System.Windows.Media.FontFamily($family)
  if ($bold) { $t.FontWeight = 'Bold' }
  [System.Windows.Controls.Canvas]::SetLeft($t, $left); [System.Windows.Controls.Canvas]::SetTop($t, $top)
  $t
}

# ---------- 視窗與錶面 (200x200 的虛擬畫布,Viewbox 負責縮放) ----------
$win = New-Object System.Windows.Window
$win.WindowStyle = 'None'
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.ShowInTaskbar = $false
$win.ResizeMode = 'NoResize'
$win.Title = 'Desk Clock'

$vb = New-Object System.Windows.Controls.Viewbox
$vb.Stretch = 'Uniform'
$canvas = New-Object System.Windows.Controls.Canvas
$canvas.Width = 200; $canvas.Height = 200
$vb.Child = $canvas
$win.Content = $vb

# 雙線樣式的外圈(其他樣式隱藏)
$rim2 = New-Object System.Windows.Shapes.Ellipse
$rim2.Width = 197; $rim2.Height = 197; $rim2.StrokeThickness = 2; $rim2.Fill = $null
[System.Windows.Controls.Canvas]::SetLeft($rim2, 1.5); [System.Windows.Controls.Canvas]::SetTop($rim2, 1.5)
[void]$canvas.Children.Add($rim2)

$face = New-Object System.Windows.Shapes.Ellipse
$grad = New-Object System.Windows.Media.RadialGradientBrush
$s1 = New-Object System.Windows.Media.GradientStop; $s1.Offset = 0.0
$s2 = New-Object System.Windows.Media.GradientStop; $s2.Offset = 1.0
$grad.GradientStops.Add($s1); $grad.GradientStops.Add($s2)
$face.Fill = $grad
[void]$canvas.Children.Add($face)

$bevel = New-Object System.Windows.Shapes.Ellipse
$bevel.Stroke = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(110, 0, 0, 0))
$bevel.StrokeThickness = 1.4; $bevel.Visibility = 'Collapsed'; $bevel.IsHitTestVisible = $false
[void]$canvas.Children.Add($bevel)

# 刻度
$tickLines = @()
for ($i = 0; $i -lt 60; $i++) {
  $a = $i * 6 * [Math]::PI / 180
  $r2 = if ($i % 5 -eq 0) { 79 } else { 83 }
  $th = if ($i % 5 -eq 0) { 2.5 } else { 1.2 }
  $ln = New-Line (100 + 87 * [Math]::Sin($a)) (100 - 87 * [Math]::Cos($a)) (100 + $r2 * [Math]::Sin($a)) (100 - $r2 * [Math]::Cos($a)) ([System.Windows.Media.Brushes]::Gray) $th $false
  $tickLines += $ln
  [void]$canvas.Children.Add($ln)
}
# 數字
$numTbs = @()
for ($n = 1; $n -le 12; $n++) {
  $a = $n * 30 * [Math]::PI / 180
  $tb = New-Text "$n" (100 + 66 * [Math]::Sin($a) - 15) (100 - 66 * [Math]::Cos($a) - 13) 30 18 ([System.Windows.Media.Brushes]::Gray) $true 'Segoe UI'
  $numTbs += $tb
  [void]$canvas.Children.Add($tb)
}
# 日期與上下午
$dateTb = New-Text '' 22 56 156 16 ([System.Windows.Media.Brushes]::Gray) $false 'Microsoft JhengHei UI'
$dateTb.FontWeight = 'SemiBold'
$ampmTb = New-Text '' 70 126 60 15 ([System.Windows.Media.Brushes]::Gray) $false 'Georgia'
[void]$canvas.Children.Add($dateTb); [void]$canvas.Children.Add($ampmTb)

# 指針 (RotateTransform 以 (100,100) 為圓心)
$hourH = New-Line 100 112 100 56 ([System.Windows.Media.Brushes]::Black) 6 $true
$minH  = New-Line 100 116 100 30 ([System.Windows.Media.Brushes]::Black) 4 $true
$secH  = New-Line 100 122 100 20 ([System.Windows.Media.Brushes]::Red) 1.6 $true
$hourRot = New-Object System.Windows.Media.RotateTransform(0, 100, 100); $hourH.RenderTransform = $hourRot
$minRot  = New-Object System.Windows.Media.RotateTransform(0, 100, 100); $minH.RenderTransform = $minRot
$secRot  = New-Object System.Windows.Media.RotateTransform(0, 100, 100); $secH.RenderTransform = $secRot
[void]$canvas.Children.Add($hourH); [void]$canvas.Children.Add($minH); [void]$canvas.Children.Add($secH)
$dotC = New-Object System.Windows.Shapes.Ellipse; $dotC.Width = 10; $dotC.Height = 10
[System.Windows.Controls.Canvas]::SetLeft($dotC, 95); [System.Windows.Controls.Canvas]::SetTop($dotC, 95)
$dotS = New-Object System.Windows.Shapes.Ellipse; $dotS.Width = 5; $dotS.Height = 5
[System.Windows.Controls.Canvas]::SetLeft($dotS, 97.5); [System.Windows.Controls.Canvas]::SetTop($dotS, 97.5)
[void]$canvas.Children.Add($dotC); [void]$canvas.Children.Add($dotS)

function Apply-Theme {
  $t = $themes[[string]$cfg.theme]
  if (-not $t) { $t = $themes['classic'] }
  $s1.Color = [System.Windows.Media.ColorConverter]::ConvertFromString($t.faceC)
  $s2.Color = [System.Windows.Media.ColorConverter]::ConvertFromString($t.faceE)
  $face.Stroke = Br $t.rim
  $rim2.Stroke = Br $t.rim2
  $tb = Br $t.tick; foreach ($l in $tickLines) { $l.Stroke = $tb }
  $nb = Br $t.num;  foreach ($x in $numTbs) { $x.Foreground = $nb }
  $dateTb.Foreground = Br $t.text; $ampmTb.Foreground = Br $t.text
  $hb = Br $t.hand; $hourH.Stroke = $hb; $minH.Stroke = $hb; $dotC.Fill = $hb
  $sb = Br $t.sec;  $secH.Stroke = $sb; $dotS.Fill = $sb
}
function Apply-Rim {
  # 外緣固定落在半徑 ~99.5,各樣式的內緣都 >= 90.5,不會壓到刻度(刻度從半徑 89 起)
  $r = 96; $th = 7; $dbl = $false
  switch ([string]$cfg.rim) {
    'none'   { $r = 96;   $th = 0 }
    'thin'   { $r = 98;   $th = 3 }
    'thick'  { $r = 94.5; $th = 10 }
    'double' { $r = 93;   $th = 5; $dbl = $true }
  }
  $script:rimR = $r; $script:rimTh = $th
  $face.Width = 2 * $r; $face.Height = 2 * $r
  [System.Windows.Controls.Canvas]::SetLeft($face, 100 - $r); [System.Windows.Controls.Canvas]::SetTop($face, 100 - $r)
  $face.StrokeThickness = $th
  $rim2.Visibility = if ($dbl) { 'Visible' } else { 'Collapsed' }
}

$texCache = @{}
function Get-Tex([string]$kind) {
  if (-not $texCache.ContainsKey($kind)) {
    $bm = [DcTex]::Make($kind, 400)
    $ms = New-Object System.IO.MemoryStream
    $bm.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bm.Dispose()
    $ms.Position = 0
    $bi = New-Object System.Windows.Media.Imaging.BitmapImage
    $bi.BeginInit(); $bi.StreamSource = $ms; $bi.CacheOption = 'OnLoad'; $bi.EndInit(); $bi.Freeze()
    $texCache[$kind] = $bi
  }
  return $texCache[$kind]
}
function New-TexBrush([string]$kind, [double]$off) {
  # 貼圖用絕對座標對應整張 200x200 畫布(形狀區域座標原點 = 橢圓左上角,所以要平移 off)
  $ib = New-Object System.Windows.Media.ImageBrush -ArgumentList (Get-Tex $kind)
  $ib.ViewportUnits = 'Absolute'; $ib.Viewport = New-Object System.Windows.Rect(-$off, -$off, 200, 200)
  $ib.Stretch = 'Fill'; $ib.TileMode = 'None'
  return $ib
}
function Apply-Frame {
  $k = [string]$cfg.frame
  if ($k -eq 'color' -or -not $frames.Contains($k) -or $script:rimTh -le 0) { $bevel.Visibility = 'Collapsed'; return }
  $face.Stroke = New-TexBrush $k (100 - $script:rimR)
  $rim2.Stroke = New-TexBrush $k 1.5
  $ri = $script:rimR - $script:rimTh / 2
  $bevel.Width = 2 * $ri; $bevel.Height = 2 * $ri
  [System.Windows.Controls.Canvas]::SetLeft($bevel, 100 - $ri); [System.Windows.Controls.Canvas]::SetTop($bevel, 100 - $ri)
  $bevel.Visibility = 'Visible'
}

$inv = [System.Globalization.CultureInfo]::InvariantCulture
function Update-Clock {
  $n = Get-Date
  $hourRot.Angle = (($n.Hour % 12) + $n.Minute / 60.0) * 30
  $minRot.Angle = ($n.Minute + $n.Second / 60.0) * 6
  $secRot.Angle = $n.Second * 6
  $roc = $n.Year - 1911
  $dateTb.Text = switch ([int]$cfg.dateStyle) {
    1 { '{0}年{1}月{2}日' -f $roc, $n.Month, $n.Day }
    2 { '{0}月{1}日 週{2}' -f $n.Month, $n.Day, '日一二三四五六'[[int]$n.DayOfWeek] }
    default { '{0}/{1:00}/{2:00}' -f $roc, $n.Month, $n.Day }
  }
  $ampmTb.Text = if ($n.Hour -lt 12) { 'AM' } else { 'PM' }
}

# ---------- 套用設定 ----------
$script:hovering = $false
$script:dragging = $false
$script:suppressUntil = [DateTime]::MinValue
$helper = New-Object System.Windows.Interop.WindowInteropHelper($win)
$hwnd = $helper.EnsureHandle()
$HWND_TOPMOST = [IntPtr]::new(-1)

function Assert-Topmost {
  if ($cfg.topmost) { [void][DcNative]::SetWindowPos($hwnd, $HWND_TOPMOST, 0, 0, 0, 0, 0x13) }
}
function Apply-Opacity {
  $base = [Math]::Min(1.0, [Math]::Max(0.1, [double]$cfg.opacity))
  $eff = $base
  if ($script:hovering -and $cfg.hoverFade) { $eff = [Math]::Min($base, [Math]::Max(0.05, [double]$cfg.hoverOpacity)) }
  $win.Opacity = $eff
}
function Set-ExStyle([bool]$transparent) {
  # 0x80 TOOLWINDOW(不進 Alt-Tab) | 0x08000000 NOACTIVATE(點它不搶焦點) | 0x20 TRANSPARENT(滑鼠穿透)
  $ex = [DcNative]::GetWindowLong($hwnd, -20) -bor 0x80 -bor 0x08000000
  if ($transparent) { $ex = $ex -bor 0x20 } else { $ex = $ex -band (-bnot 0x20) }
  [void][DcNative]::SetWindowLong($hwnd, -20, $ex)
}
function Apply-Settings {
  $s = [int]$cfg.size
  $win.Width = $s; $win.Height = $s
  Apply-Opacity
  $win.Topmost = [bool]$cfg.topmost
  $dateTb.Visibility = if ($cfg.showDate) { 'Visible' } else { 'Collapsed' }
  $ampmTb.Visibility = if ($cfg.showAmPm) { 'Visible' } else { 'Collapsed' }
  $dateTb.FontSize = switch ([int]$cfg.dateStyle) { 1 { 14 } 2 { 14 } default { 16 } }
  Apply-Theme; Apply-Rim; Apply-Frame; Update-Clock
  Set-ExStyle ([bool]$cfg.clickThrough)
  Assert-Topmost
  Save-Cfg
}
function Set-Size([int]$new) {
  $new = [Math]::Min(600, [Math]::Max(80, $new))
  $cx = $win.Left + $win.Width / 2; $cy = $win.Top + $win.Height / 2
  $cfg.size = $new
  $win.Width = $new; $win.Height = $new
  $win.Left = $cx - $new / 2; $win.Top = $cy - $new / 2
  $cfg.left = $win.Left; $cfg.top = $win.Top
  Apply-Settings
}
function Move-ToCorner {
  $wa = [System.Windows.SystemParameters]::WorkArea
  $win.Left = $wa.Right - [double]$cfg.size - 16
  $win.Top = $wa.Top + 16
  $cfg.left = $win.Left; $cfg.top = $win.Top
  Save-Cfg
}

# 初始位置:沒存過、或存的位置已經不在任何螢幕上,就放右上角
$vl = [System.Windows.SystemParameters]::VirtualScreenLeft; $vt = [System.Windows.SystemParameters]::VirtualScreenTop
$vw = [System.Windows.SystemParameters]::VirtualScreenWidth; $vh = [System.Windows.SystemParameters]::VirtualScreenHeight
$okPos = ($null -ne $cfg.left) -and ($null -ne $cfg.top) -and ([double]$cfg.left -gt $vl - [double]$cfg.size + 60) -and ([double]$cfg.left -lt $vl + $vw - 60) -and ([double]$cfg.top -gt $vt - [double]$cfg.size + 60) -and ([double]$cfg.top -lt $vt + $vh - 60)
$win.WindowStartupLocation = 'Manual'
if ($okPos) { $win.Left = [double]$cfg.left; $win.Top = [double]$cfg.top } else { $win.Width = [int]$cfg.size; Move-ToCorner }
Apply-Settings

# ---------- 滑鼠操作 ----------
$restoreTimer = New-Object System.Windows.Threading.DispatcherTimer
$restoreTimer.Interval = [TimeSpan]::FromMilliseconds(600)
$restoreTimer.Add_Tick({ $restoreTimer.Stop(); Set-ExStyle ([bool]$cfg.clickThrough) })

function Send-PassThroughRightClick {
  # 暫時讓視窗變成滑鼠穿透,補送一次右鍵給底下的視窗/桌面,稍後恢復
  Set-ExStyle $true
  [DcNative]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)   # RIGHTDOWN
  [DcNative]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)   # RIGHTUP
  $restoreTimer.Stop(); $restoreTimer.Start()
}

$win.Add_MouseLeftButtonDown({
  if ($cfg.clickThrough) { return }
  $script:dragging = $true
  try { $win.DragMove() } catch { }
  $script:dragging = $false
  $cfg.left = $win.Left; $cfg.top = $win.Top
  Save-Cfg
})
$win.Add_MouseWheel({
  param($s, $e)
  if ([System.Windows.Input.Keyboard]::Modifiers -band [System.Windows.Input.ModifierKeys]::Control) {
    Set-Size ([int]$cfg.size + $(if ($e.Delta -gt 0) { 10 } else { -10 }))
  } else {
    $o = [double]$cfg.opacity + $(if ($e.Delta -gt 0) { 0.05 } else { -0.05 })
    $cfg.opacity = [Math]::Round([Math]::Min(1.0, [Math]::Max(0.1, $o)), 2)
    # 調整期間暫停「游標移上去變透明」,才看得到調整結果
    $script:suppressUntil = [DateTime]::Now.AddSeconds(2)
    $script:hovering = $false
    Apply-Settings
  }
})

# ---------- 選單 (視窗右鍵 + 系統匣共用) ----------
$menu = New-Object System.Windows.Forms.ContextMenuStrip
function Add-Item($parent, [string]$text, $tag, [scriptblock]$onClick) {
  $it = New-Object System.Windows.Forms.ToolStripMenuItem($text)
  $it.Tag = $tag
  $it.Add_Click($onClick)
  [void]$parent.DropDownItems.Add($it)
  $it
}
function Add-Toggle([string]$text, [scriptblock]$onClick) {
  $it = New-Object System.Windows.Forms.ToolStripMenuItem($text)
  $it.Add_Click($onClick)
  [void]$menu.Items.Add($it)
  $it
}
function New-Sub([string]$text) {
  $it = New-Object System.Windows.Forms.ToolStripMenuItem($text)
  [void]$menu.Items.Add($it)
  $it
}
function New-Swatch($t) {
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $fill = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($t.faceE))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($t.rim)), 2.5
  $g.FillEllipse($fill, 1, 1, 14, 14); $g.DrawEllipse($pen, 1.5, 1.5, 12, 12)
  $g.Dispose(); $bmp
}

$miTop = Add-Toggle '永遠置頂' { $cfg.topmost = -not [bool]$cfg.topmost; Apply-Settings }
$miThrough = Add-Toggle '滑鼠穿透(鎖定,只能從系統匣取消)' { $cfg.clickThrough = -not [bool]$cfg.clickThrough; Apply-Settings }
$miRight = Add-Toggle '停用時鐘右鍵選單(右鍵穿透到桌面;Ctrl+右鍵仍可叫出)' { $cfg.rightMenu = -not [bool]$cfg.rightMenu; Apply-Settings }
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$miTheme = New-Sub '配色'
$themeItems = @()
foreach ($k in $themes.Keys) {
  $it = Add-Item $miTheme $themes[$k].name $k { param($s, $e) $cfg.theme = [string]$s.Tag; Apply-Settings }
  $it.Image = New-Swatch $themes[$k]
  $themeItems += $it
}
$miRim = New-Sub '邊框'
$rimItems = @()
foreach ($k in $rims.Keys) { $rimItems += (Add-Item $miRim $rims[$k] $k { param($s, $e) $cfg.rim = [string]$s.Tag; Apply-Settings }) }

$miFrame = New-Sub '邊框材質(金屬/木質)'
$frItems = @()
foreach ($k in $frames.Keys) {
  $it = Add-Item $miFrame $frames[$k] $k {
    param($s, $e)
    $cfg.frame = [string]$s.Tag
    # 材質要有一定寬度才看得出來:原本是無邊框/細邊就自動改成標準(標準粗細已可看出材質)
    if ($cfg.frame -ne 'color' -and @('none', 'thin') -contains [string]$cfg.rim) { $cfg.rim = 'normal' }
    Apply-Settings
  }
  if ($k -ne 'color') {
    $sw = New-Object System.Drawing.Bitmap 16, 16
    $g2 = [System.Drawing.Graphics]::FromImage($sw); $g2.SmoothingMode = 'AntiAlias'
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath; $path.AddEllipse(1, 1, 14, 14); $g2.SetClip($path)
    $bmT = [DcTex]::Make($k, 400); $g2.DrawImage($bmT, 0, 0, 16, 16); $bmT.Dispose(); $g2.Dispose()
    $it.Image = $sw
  }
  $frItems += $it
}
$miDateStyle = New-Sub '日期格式'
$dsItems = @()
for ($i = 0; $i -lt $dateStyles.Count; $i++) { $dsItems += (Add-Item $miDateStyle $dateStyles[$i] $i { param($s, $e) $cfg.dateStyle = [int]$s.Tag; Apply-Settings }) }
$miDate = Add-Toggle '顯示日期' { $cfg.showDate = -not [bool]$cfg.showDate; Apply-Settings }
$miAmPm = Add-Toggle '顯示 AM/PM' { $cfg.showAmPm = -not [bool]$cfg.showAmPm; Apply-Settings }
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$miOpacity = New-Sub '透明度 (滾輪也可調)'
$opItems = @()
foreach ($p in 100, 90, 80, 60, 40, 20) { $opItems += (Add-Item $miOpacity "$p%" $p { param($s, $e) $cfg.opacity = [double]$s.Tag / 100; Apply-Settings }) }
$miHover = Add-Toggle '游標移上去變透明' { $cfg.hoverFade = -not [bool]$cfg.hoverFade; Apply-Settings }
$miHoverOp = New-Sub '移上去時的透明度'
$hoItems = @()
foreach ($p in 10, 20, 30, 50) { $hoItems += (Add-Item $miHoverOp "$p%" $p { param($s, $e) $cfg.hoverOpacity = [double]$s.Tag / 100; Apply-Settings }) }
$miSize = New-Sub '大小 (Ctrl+滾輪也可調)'
$szItems = @()
foreach ($p in @(@('小', 120), @('中', 160), @('預設', 200), @('大', 280), @('特大', 360))) {
  $szItems += (Add-Item $miSize "$($p[0]) ($($p[1]))" $p[1] { param($s, $e) Set-Size ([int]$s.Tag) })
}
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miCorner = Add-Toggle '回到右上角' { Move-ToCorner; Assert-Topmost }
$miExit = Add-Toggle '結束' { $win.Close() }

$menu.Add_Opening({
  $miTop.Checked = [bool]$cfg.topmost
  $miThrough.Checked = [bool]$cfg.clickThrough
  $miRight.Checked = -not [bool]$cfg.rightMenu
  $miDate.Checked = [bool]$cfg.showDate
  $miAmPm.Checked = [bool]$cfg.showAmPm
  $miHover.Checked = [bool]$cfg.hoverFade
  foreach ($it in $themeItems) { $it.Checked = ([string]$cfg.theme -eq [string]$it.Tag) }
  foreach ($it in $frItems) { $it.Checked = ([string]$cfg.frame -eq [string]$it.Tag) }
  foreach ($it in $rimItems) { $it.Checked = ([string]$cfg.rim -eq [string]$it.Tag) }
  foreach ($it in $dsItems) { $it.Checked = ([int]$cfg.dateStyle -eq [int]$it.Tag) }
  foreach ($it in $opItems) { $it.Checked = ([Math]::Round([double]$cfg.opacity * 100) -eq [int]$it.Tag) }
  foreach ($it in $hoItems) { $it.Checked = ([Math]::Round([double]$cfg.hoverOpacity * 100) -eq [int]$it.Tag) }
  foreach ($it in $szItems) { $it.Checked = ([int]$cfg.size -eq [int]$it.Tag) }
  # 選單打開時別讓時鐘跟著淡出
  $script:suppressUntil = [DateTime]::Now.AddSeconds(2)
})
$win.Add_MouseRightButtonUp({
  $ctrl = [System.Windows.Input.Keyboard]::Modifiers -band [System.Windows.Input.ModifierKeys]::Control
  if ($cfg.rightMenu -or $ctrl) { $menu.Show([System.Windows.Forms.Cursor]::Position) } else { Send-PassThroughRightClick }
})

# ---------- 系統匣圖示 ----------
$bmp = New-Object System.Drawing.Bitmap 32, 32
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.FillEllipse([System.Drawing.Brushes]::White, 2, 2, 28, 28)
$penRim = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(58, 120, 194)), 3
$g.DrawEllipse($penRim, 2, 2, 28, 28)
$penHand = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(30, 34, 41)), 3
$g.DrawLine($penHand, 16, 16, 16, 7)
$g.DrawLine($penHand, 16, 16, 23, 20)
$g.Dispose()
$hIcon = $bmp.GetHicon()
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.Icon]::FromHandle($hIcon)
$notify.Text = 'Desk Clock'
$notify.ContextMenuStrip = $menu
$notify.Visible = $true
$notify.Add_DoubleClick({ Move-ToCorner; Assert-Topmost })

# ---------- 計時 ----------
function Test-Hover {
  $p = [System.Windows.Forms.Cursor]::Position
  $pt = $win.PointFromScreen((New-Object System.Windows.Point($p.X, $p.Y)))
  $r = $win.Width / 2
  $dx = $pt.X - $r; $dy = $pt.Y - $r
  return (($dx * $dx + $dy * $dy) -le ($r * $r))
}
$tick = New-Object System.Windows.Threading.DispatcherTimer
$tick.Interval = [TimeSpan]::FromMilliseconds(250)
$tick.Add_Tick({ Update-Clock })
$tick.Start()
$hoverTimer = New-Object System.Windows.Threading.DispatcherTimer
$hoverTimer.Interval = [TimeSpan]::FromMilliseconds(100)
$hoverTimer.Add_Tick({
  $h = $false
  if ($cfg.hoverFade -and -not $script:dragging -and ([DateTime]::Now -gt $script:suppressUntil)) {
    try { $h = Test-Hover } catch { if (-not $script:hoverErrLogged) { $script:hoverErrLogged = $true; try { ("[{0}] hover: {1}" -f (Get-Date), $_.Exception.Message) | Add-Content -Path $logPath -Encoding UTF8 } catch { } } }
  }
  if ($h -ne $script:hovering) { $script:hovering = $h; Apply-Opacity }
})
$hoverTimer.Start()
$guard = New-Object System.Windows.Threading.DispatcherTimer
$guard.Interval = [TimeSpan]::FromSeconds(20)
$guard.Add_Tick({ Assert-Topmost })
$guard.Start()

$win.Add_Closed({
  $tick.Stop(); $hoverTimer.Stop(); $guard.Stop()
  $notify.Visible = $false; $notify.Dispose()
  [void][DcNative]::DestroyIcon($hIcon)
})

[void]$win.ShowDialog()
try { $mutex.ReleaseMutex() } catch { }
}
catch {
  try { ("[{0}] {1}`n{2}`n" -f (Get-Date), $_.Exception.Message, $_.ScriptStackTrace) | Add-Content -Path $logPath -Encoding UTF8 } catch { }
}
