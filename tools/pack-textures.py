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

已经跑过的稿子（重跑贴图时直接抄这几条）：

    # 盒马（三份稿都在 D:/deskbox/room/仓库/箱子包装/盒马/）
    鲜汁大肉包外箱.pdf   hm-meat    --xs 174.5,1591.9,2541.5,3958.8,4908.4 --flap 479.5,954.3  --body 954.3,1492.9  --size 500x335x190
    青菜包外箱.pdf       hm-green   --xs 251.6,1668.9,2632.7,4050.0,5013.8 --flap 483.6,965.5  --body 965.5,1532.4 --size 500x340x200
    烧麦外箱转曲.pdf     hm-shao    --xs 0.3,1318.4,2494.8,3812.9,4989.2   --flap 201.3,789.5  --body 789.5,1455.6 --size 465x410x235

    # 快乐猴（D:/deskbox/room/仓库/箱子包装/快乐猴/）
    # 包子稿一页里上下两套：上=菜包，下=肉包，--flap/--body 换一组就行
    快乐猴80g包子外箱.pdf  klh-green --xs 149,1566.3,2530.1,3947.4,4911.2 --flap 406.7,888.6 --body 888.6,1512.2 --size 500x340x220
                         klh-meat  --xs 149,1566.3,2530.1,3947.4,4911.2 --flap 1614.7,2096.6 --body 2096.6,2720.2 --size 500x340x220
    快乐猴600g菜团子外箱.pdf klh-cai --xs 143.7,1405.2,2397.3,3658.7,4650.8 --flap 261.5,757.6 --body 757.6,1522.9 --size 445x350x270
    快乐猴2kg 水饺外箱.pdf  klh-jiao --xs 114,1332.9,2183.3,3402.2,4252.6 --flap 241.4,666.6 --body 666.6,1318.6 --size 430x300x230
    快乐猴 糯米鸡600克x20袋外箱.pdf klh-nuo --xs 160.7,1294.6,2272.5,3406.4,4384.3 --flap 327.1,816 --body 816,1482.2 --size 400x345x235
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
