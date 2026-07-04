---
name: see
description: Inspect rendered visual output by capturing and viewing screenshots. Use after changing a web page, HTML document, chart, UI, canvas, or visual asset, or when asked whether something is readable, laid out correctly, or visually rough.
---

Do not infer visual quality from source code when a real render is available.
Render the target, capture an image, inspect the image directly, then fix what
the image proves.

A screenshot judges what a surface *shows*, not whether it *works or makes
sense to use* — a static capture cannot click a fake expander or feel a
redundant flow. To judge an interface as an experience, drive it with the
explorative-testing skill and use this skill as its camera.

## Procedure

1. Start or identify the local server when the artifact needs one. For standalone
   HTML, a file URL is enough.
2. Capture the relevant viewport with a bounded headless browser command.
3. Open the screenshot with the available image-viewing tool.
4. Judge what is actually visible: framing, readability, overlap, empty states,
   contrast, scroll depth, responsive behavior, and missing assets.
5. Fix concrete visual defects and capture again when verification matters.

## Example Commands

The examples use `google-chrome`; substitute whichever Chromium-family binary
the machine has (`chromium`, `chromium-browser`, `headless_shell`) or an
installed Playwright browser.

Running page:

```bash
timeout -k 5 60 google-chrome --headless --disable-gpu --no-sandbox \
  --hide-scrollbars --virtual-time-budget=4000 --window-size=1280,1400 \
  --screenshot=/tmp/see/page.png http://127.0.0.1:8000/
```

Standalone HTML:

```bash
timeout -k 5 60 google-chrome --headless --disable-gpu --no-sandbox \
  --window-size=1280,1000 --screenshot=/tmp/see/page.png \
  "file:///absolute/path/to/page.html"
```

If capture hangs or produces no image, stop the stale browser process for that
capture path before retrying with a bounded command.

## Output

Report what the screenshot shows, the concrete visual defects found, and the
verification screenshot path. Do not claim a UI is visually correct unless you
looked at a rendered image.
