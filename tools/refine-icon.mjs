#!/usr/bin/env node
// 收紧 icon 黑边 + 圆角，并同步 assets/
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const py = `
from PIL import Image, ImageDraw
import numpy as np

src = r"${ROOT.replace(/\\/g, "\\\\")}\\icon.png"
out = src
size = 1024
radius = int(size * 0.185)
bg = (10, 13, 20, 255)

im = Image.open(src).convert("RGBA")
arr = np.array(im)
rgb = arr[:, :, :3]
luma = rgb.max(axis=2)
mask = luma > 28
if not mask.any():
    raise SystemExit("no content detected")
ys, xs = np.where(mask)
pad = max(8, int(max(xs.max()-xs.min(), ys.max()-ys.min()) * 0.04))
x0, x1 = max(0, xs.min() - pad), min(im.width, xs.max() + pad + 1)
y0, y1 = max(0, ys.min() - pad), min(im.height, ys.max() + pad + 1)
cropped = im.crop((x0, y0, x1, y1))

# 放大内容填满画布（缩小黑边）
canvas = Image.new("RGBA", (size, size), bg)
cw, ch = cropped.size
scale = min(size / cw, size / ch)
nw, nh = int(cw * scale), int(ch * scale)
scaled = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
ox, oy = (size - nw) // 2, (size - nh) // 2
canvas.paste(scaled, (ox, oy), scaled)

# 圆角蒙版
corner = Image.new("L", (size, size), 0)
draw = ImageDraw.Draw(corner)
draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
out_im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
out_im.paste(canvas, (0, 0), corner)
out_im.save(out, "PNG")

assets = r"${ROOT.replace(/\\/g, "\\\\")}\\assets"
import os
os.makedirs(assets, exist_ok=True)
out_im.save(os.path.join(assets, "icon.png"), "PNG")
tray = out_im.resize((32, 32), Image.Resampling.LANCZOS)
tray.save(os.path.join(assets, "tray.png"), "PNG")
print(f"ok {size}x{size} radius={radius} crop=({x0},{y0},{x1},{y1})")
`;

const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
process.exit(r.status ?? 1);
