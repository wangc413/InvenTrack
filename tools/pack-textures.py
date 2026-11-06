#!/usr/bin/env python3
"""从外箱刀版稿（PDF）裁 3D 贴图。

设计稿是一张展开图：躺平的一排面板 = 正面(L×H) / 侧面(W×H) / 背面(L×H) / 侧面(W×H)，
上面一条是四个摇盖，每个摇盖的进深 = W/2。

用法：
    python tools/pack-textures.py <pdf> <输出前缀> --xs 149,1566,2530,3947,4911 \
        --flap 407,889 --body 889,1512 --size 500x340x220

    # 一页里有上下两套（比如包子稿同时有菜包和肉包），第二套用 --flap/--body 指定下面那组
    参数里的数字是 PDF 坐标（pt），从 `page.get_drawings()` 的大矩形里读：
      横向 5 个 x 是 4 个面板的边界；flap/body 是摇盖和箱身各自的 y 区间。

产出三张 WebP：<前缀>-front.webp / -side.webp / -top.webp
顶面是把前摇盖放下半张、后摇盖转 180° 放上半张拼出来的 —— 合盖后就是这样。
"""
import argparse
import io

import pymupdf
from PIL import Image

INSET = 2.0  # 躲开刀版红线的 2pt


def render(page, rect, target_w):
    z = target_w / rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=rect, alpha=False)
    return Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('prefix')
    ap.add_argument('--xs', required=True, help='四个面板的 5 个 x 边界，逗号分隔')
    ap.add_argument('--flap', required=True, help='摇盖 y0,y1')
    ap.add_argument('--body', required=True, help='箱身 y0,y1')
    ap.add_argument('--size', required=True, help='外径 长x宽x高，毫米')
    ap.add_argument('--out', default='src/assets/pack')
    a = ap.parse_args()

    x0, x1, x2, x3, _x4 = (float(v) for v in a.xs.split(','))
    fy0, fy1 = (float(v) for v in a.flap.split(','))
    by0, by1 = (float(v) for v in a.body.split(','))
    L, W, _H = (float(v) for v in a.size.lower().split('x'))

    page = pymupdf.open(a.pdf)[0]

    front = render(page, pymupdf.Rect(x0 + INSET, by0 + INSET, x1 - INSET, by1 - INSET), 1024)
    front.save(f'{a.out}/{a.prefix}-front.webp', quality=86, method=6)

    side = render(page, pymupdf.Rect(x1 + INSET, by0 + INSET, x2 - INSET, by1 - INSET), 640)
    side.save(f'{a.out}/{a.prefix}-side.webp', quality=86, method=6)

    flap_front = render(page, pymupdf.Rect(x0 + INSET, fy0 + INSET, x1 - INSET, fy1 - INSET), 1024)
    flap_back = render(page, pymupdf.Rect(x2 + INSET, fy0 + INSET, x3 - INSET, fy1 - INSET), 1024)
    top_w = 1024
    top_h = round(top_w * W / L)
    half = top_h // 2
    canvas = Image.new('RGB', (top_w, top_h), flap_front.getpixel((5, 5)))
    canvas.paste(flap_back.resize((top_w, half), Image.LANCZOS).rotate(180), (0, 0))
    canvas.paste(flap_front.resize((top_w, top_h - half), Image.LANCZOS), (0, half))
    canvas.save(f'{a.out}/{a.prefix}-top.webp', quality=86, method=6)

    print(f'{a.prefix}: front {front.size} side {side.size} top {canvas.size}')


if __name__ == '__main__':
    main()
