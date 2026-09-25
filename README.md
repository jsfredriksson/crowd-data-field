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

| | |
|---|---|
| cogwheel, top right | show / hide the control panel — becomes a cross while open |
| `H` or `Esc` | same, from the keyboard |
| `F` | fullscreen |
| `S` | save a PNG of the current frame |
| `R` | reset to defaults |

All slider values persist in localStorage, so your tuning survives a reload.

## What each control does

| Control | |
|---|---|
| **source** | where presence comes from — see below. The single biggest control over how the piece reads |
| **auto levels** | tracks the 2nd/98th percentile of the frame and stretches contrast to fit. Leave on unless you're matching a specific look |
| **black / white point** | manual contrast. Raise black to crush the room to nothing, lower white to make mid-greys solid |
| **gamma** | bends the midtones. <1 fills out, >1 thins down |
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

## Source modes — the important one

A person-mask is binary, so it can only ever give you a blob. The reference
frames this piece is built from are **tonal**: a dark athlete on a bright cyc,
with glyph density following brightness. That's what keeps the calf, the sock
and the shoe readable.

| Mode | |
|---|---|
| **tone inside silhouette** *(default)* | brightness drives density, but clipped to the person. Tonal detail without the room filling up. Auto levels measure the subject only, not the background |
| **tone** | brightness drives density across the whole frame, dark = dense. This is the reference look, and it needs a **bright background** — a white wall, a lit cyc, a window |
| **tone inverted** | bright = dense. For a lit subject against a dark room, which is what most event spaces actually are |
| **silhouette only** | the original binary mask. Cleanest cut-out, zero internal detail |

The two pure tone modes skip the segmentation model entirely, so they're also
the fastest — worth knowing on a phone.

## Architecture

```
layout()       ->  canvas + sensor + field resized to the window, aspect-matched
sensor.read()  ->  lum[MW×MH] + segm[MW×MH]
composeMask()  ->  levels(lum) combined with segm per source mode
               ->  mask[MW×MH]   (0..1 presence, long side 256)
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


## Publish to GitHub Pages (for phones)

The camera API needs a secure origin. GitHub Pages is HTTPS, so it just works
on iPhone and Android — no app, no TestFlight, no cables.

The git repo lives **outside** the vault at `~/Developer/crowd-data-field`.
That is deliberate: a `.git` folder inside iCloud Drive will eventually corrupt
itself. You keep editing here in the vault; the deploy script syncs.

Two ways to get it onto a phone:

**A · Temporary — nothing published.** Double-click `phone.command`. It starts
the local server and opens a throwaway `https://….trycloudflare.com` address
pointing at your Mac. Good for a quick look or a demo in the room. The link
dies when you close the window, and your Mac has to stay awake.

**B · Permanent — a real URL to send people.** Double-click `go-public.command`
once. It flips the repo to public (it asks first) and turns Pages on at
`https://jsfredriksson.github.io/crowd-data-field/`. After that,
`deploy.command` pushes any change live in ~30 seconds.

GitHub Pages will not serve a **private** repo unless you pay for Pro — that is
why `publish.command` appeared to work but left a dead URL. If you want to stay
private and still have a permanent address, Cloudflare Pages does it free, but
you have to connect the repo through their dashboard by hand.

### On the phone

Open the URL in **Safari** → allow camera → `Share` → **Add to Home Screen**.
Launched from the home screen it runs fullscreen with no browser chrome, which
is the only way it reads as an installation rather than a web page.

- The **camera** control switches front / back. Back camera for showing a room,
  front for the selfie-mirror version. Mirroring follows automatically.
- Tap the **cogwheel, top right** for the controls — the panel becomes a bottom
  sheet and the cogwheel turns into a cross. Close it with that same button or
  by tapping the field behind it. It sits top right precisely so the sheet can
  never cover the only way out of itself.

  Both marks are pixel-drawn: the cogwheel on a 5×5 grid, the cross being the
  pixel plus turned 45° with its centre punched out.
- Sensor and canvas resolution are capped lower on touch devices so it holds
  frame rate. Expect ~30fps on a recent iPhone.
- Nothing is uploaded. All processing is on-device, in the browser.

## The icon

A camera lens built entirely out of the field's own vocabulary — same tokens,
same weights, same black-and-white rule as the app. Nothing decorative added.

`python3 make-icon.py` regenerates `icon.png` (512), `icon-180.png` (iOS home
screen) and `favicon.png`. Needs ImageMagick. Edit `TOKENS` at the top to keep
it in step with `TOKEN_SETS.metabolic` in `app.js`, or `BARREL_OUT / GAP_IN /
GAP_OUT / PUPIL` to reshape the lens.

It renders in Menlo because Maurten Mono isn't installed on this machine —
point `FONT` at the real file and re-run when it is.
