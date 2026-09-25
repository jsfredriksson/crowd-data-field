# Crowd Data Field — prototype

Camera → presence mask → decaying heat field → typographic glyph field.
Black canvas, white Maurten Mono tokens.

Fills the browser window by default. The **format** control letterboxes to a
locked ratio — `1:1` previews a cube face. Sensor, heat field and type all
follow the canvas, so nothing stretches at any aspect.

## Run

Double-click `run.command`, or:

```
python3 -m http.server 8123
open http://localhost:8123
```

Must be served over `http://localhost` — `file://` blocks camera access.
Chrome is the safest browser for the GPU delegate; Safari works too.

## Controls

| Key | |
|---|---|
| `H` | show / hide the control panel |
| `F` | fullscreen |
| `S` | save a PNG of the current frame |
| `R` | reset to defaults |

All slider values persist in localStorage, so your tuning survives a reload.

## What each control does

| Control | |
|---|---|
| **format** | fill window, or letterbox to 1:1 / 16:9 / 9:16 / 4:1 |
| **token set** | the vocabulary of the field. Edit `TOKEN_SETS` in `app.js` to add your own, with per-token weights |
| **type size** | glyph size in px against a **1200px reference short side** — the look is resolution-independent, so a value tuned on a laptop holds on an LED wall |
| **leading ratio** | row spacing as a multiple of type size. ~2.6 matches the reference |
| **density** | how readily a slot fills. Low = sparse and dissolved, high = solid mass |
| **trail decay** | how long a person's presence lingers after they move. The single most expressive control — low is a crisp silhouette, high is a smear of history |
| **threshold** | presence level below which nothing is drawn |
| **edge falloff** | how sharply density drops at the silhouette edge. Higher = more dithered, more like the reference |
| **min opacity** | floor brightness for a drawn token |
| **mirror** | flip horizontally so the crowd sees itself the right way round |
| **show mask** | debug overlay of the raw heat field |

## Architecture

```
layout()       ->  canvas + sensor + field resized to the window, aspect-matched
sensor.read()  ->  mask[MW×MH]   (0..1 presence, long side 256)
updateField()  ->  heat[MW/2 × MH/2]  (rise instant, fall by decay) -> 3×3 blur
render()       ->  row-flow token layout, dithered by presence
                   margin = 3% of format diagonal (guidelines)
```

Two sensors ship today:

- **mediapipe · rgb segmentation** — default. Webcam + selfie segmentation model.
- **fallback · background subtraction** — automatic if the model can't load. Needs a static camera, works offline.

### Porting to the depth camera

`app.js` → `SENSORS` section. A depth sensor only has to fill the same
`mask` array with 0..1 presence. Nothing downstream changes.

Depth threshold ≈ `presence = clamp((far - d) / (far - near), 0, 1)` — which
gives you *free* depth-fade: people closer to the camera burn brighter. That's
a better-looking effect than anything RGB segmentation can do, and it's less
code, not more.

## Known limits of this prototype

- RGB segmentation is trained on one or two people near a laptop. It will
  wobble on a real crowd, and it depends on light. That is expected — this
  prototype exists to lock the **look**, not the sensing.
- Runs at the browser's frame rate; on a Mac it should hold 60fps.
