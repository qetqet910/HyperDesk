# record.mjs 프레임을 GIF로 묶는다. usage: python make_gif.py <frameDir> <out.gif> [width]
import json, sys
from pathlib import Path
from PIL import Image

src, out = Path(sys.argv[1]), sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 960
meta = json.loads((src / "frames.json").read_text())

imgs, durs = [], []
for i, f in enumerate(meta):
    im = Image.open(src / f["name"]).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    nxt = meta[i + 1]["t"] if i + 1 < len(meta) else f["t"] + 1500  # 마지막 프레임은 잠깐 멈춤
    # 연속으로 같은 화면이면 한 프레임으로 합쳐 용량을 줄인다
    if imgs and im.tobytes() == imgs[-1].tobytes():
        durs[-1] += nxt - f["t"]
        continue
    imgs.append(im)
    durs.append(nxt - f["t"])

# 전 프레임 공통 팔레트 — 프레임마다 팔레트가 바뀌면 배경이 번쩍인다
pal = imgs[len(imgs) // 2].quantize(colors=128, method=Image.Quantize.MEDIANCUT)
frames = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in imgs]
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durs, loop=0, optimize=True)
print(out, len(frames), "frames", sum(durs), "ms")
