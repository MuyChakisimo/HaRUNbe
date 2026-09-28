<#
    Turns a character picture into a HaRUNbe skin sprite (Windows PowerShell, no installs needed).

      powershell -ExecutionPolicy Bypass -File tools\make-skin.ps1 -Source C:\path\picture.png -Name RaceCarGorilla

    - Makes a solid pure-black background transparent (skip with -KeepBackground if the
      picture is already a transparent PNG).
    - Crops to the character, scales it to fit the gorilla's 256x256 box and stands it on the
      same ground line as the default gorilla.
    - Writes Assets\Player\256x256<Name>.png (used by the game) and Assets\Player\<Name>.png
      (full-size transparent copy, kept as the source art).
    - Prints the `scale` to use in skins.js when the character is much shorter than the gorilla.
#>
param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Name,
    [int]$Threshold = 3,          # background pixels must be at least this dark (0-255) to be removed
    [switch]$KeepBackground
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'Assets\Player'
$full = Join-Path $outDir "$Name.png"
$sprite = Join-Path $outDir "256x256$Name.png"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class HarunbeSkinTool {
    static int[] Pixels(Bitmap src, out int w, out int h) {
        w = src.Width; h = src.Height;
        var bm = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bm)) g.DrawImage(src, 0, 0, w, h);
        var d = bm.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var a = new int[w * h];
        Marshal.Copy(d.Scan0, a, 0, a.Length);
        bm.UnlockBits(d);
        bm.Dispose();
        return a;
    }

    static Bitmap FromPixels(int[] a, int w, int h) {
        var bm = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var d = bm.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(a, 0, d.Scan0, a.Length);
        bm.UnlockBits(d);
        return bm;
    }

    static int Max(int c) { return Math.Max((c >> 16) & 255, Math.Max((c >> 8) & 255, c & 255)); }

    // Flood-fill near-black pixels from the picture's border and make them transparent.
    // Dark pixels inside the character (outlines, tyres) are untouched because the fill
    // can't reach them through the outline.
    public static Bitmap Cut(Bitmap src, int threshold, bool keep) {
        int w, h;
        var a = Pixels(src, out w, out h);
        if (keep) return FromPixels(a, w, h);
        var bg = new bool[w * h];
        var q = new Queue<int>();
        for (int x = 0; x < w; x++) { q.Enqueue(x); q.Enqueue((h - 1) * w + x); }
        for (int y = 0; y < h; y++) { q.Enqueue(y * w); q.Enqueue(y * w + w - 1); }
        while (q.Count > 0) {
            int i = q.Dequeue();
            if (bg[i] || Max(a[i]) > threshold) continue;
            bg[i] = true;
            int x = i % w, y = i / w;
            if (x > 0) q.Enqueue(i - 1);
            if (x < w - 1) q.Enqueue(i + 1);
            if (y > 0) q.Enqueue(i - w);
            if (y < h - 1) q.Enqueue(i + w);
        }
        var o = new int[w * h];
        for (int i = 0; i < w * h; i++) {
            if (bg[i]) { o[i] = 0; continue; }
            int x = i % w, y = i / w;
            bool edge = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
            int alpha = (a[i] >> 24) & 255;
            if (edge) alpha = Math.Min(alpha, 120 + Max(a[i]) * 8); // soften the cut edge
            o[i] = (alpha << 24) | (a[i] & 0xFFFFFF);
        }
        return FromPixels(o, w, h);
    }

    // Bounding box of clearly visible pixels: x, y, width, height.
    public static int[] Bounds(Bitmap bm) {
        int w, h;
        var a = Pixels(bm, out w, out h);
        int x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            if (((a[y * w + x] >> 24) & 255) > 40) {
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
        if (x1 < 0) throw new Exception("The picture is empty after removing the background.");
        return new int[] { x0, y0, x1 - x0 + 1, y1 - y0 + 1 };
    }

    public static void Place(Bitmap src, string dst, int[] box, float dx, float dy, float dw, float dh) {
        using (var o = new Bitmap(256, 256, PixelFormat.Format32bppArgb)) {
            using (var g = Graphics.FromImage(o)) {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.DrawImage(src, new RectangleF(dx, dy, dw, dh), new RectangleF(box[0], box[1], box[2], box[3]), GraphicsUnit.Pixel);
            }
            o.Save(dst, ImageFormat.Png);
        }
    }
}
'@

# The default gorilla's visible area inside its 256x256 sprite: x 6..250, y 16..241 (241 = feet).
$FIT_W = 244; $FIT_H = 225; $FEET_Y = 241; $CENTER_X = 128
$HITBOX_TOP_Y = 0.17 * 256   # top of the gameplay hitbox inside the sprite (see SPRITES in engine.js)

$src = New-Object System.Drawing.Bitmap (Resolve-Path $Source).Path
$cut = [HarunbeSkinTool]::Cut($src, $Threshold, [bool]$KeepBackground)
$src.Dispose()
$cut.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)

$box = [HarunbeSkinTool]::Bounds($cut)
$k = [Math]::Min($FIT_W / $box[2], $FIT_H / $box[3])
$w = $box[2] * $k; $h = $box[3] * $k
[HarunbeSkinTool]::Place($cut, $sprite, $box, ($CENTER_X - $w / 2), ($FEET_Y - $h), $w, $h)
$cut.Dispose()

Write-Host "Saved $sprite"
Write-Host "Saved $full"
Write-Host ("Character fitted to {0:N0} x {1:N0} px (the gorilla is 244 x 225)." -f $w, $h)
if ($h -lt 190) {
    $scale = [Math]::Round(($FEET_Y - $HITBOX_TOP_Y) / $h, 2)
    Write-Host "It is shorter than the gorilla. Add  scale: $scale  to its skins.js entry so it fills the hitbox."
}
