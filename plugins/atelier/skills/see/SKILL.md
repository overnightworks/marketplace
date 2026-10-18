---
name: see
description: Inspect rendered visual output by capturing and viewing screenshots of it yourself. Use after changing a web page, HTML document, UI, canvas, or visual asset, or when asked whether something is readable, laid out correctly, or visually rough. Launching the app is the run skill's job; building a chart is the dataviz skill's.
---

Do not infer visual quality from source code when a real render is available.
Open the target in a browser, take a screenshot, inspect the screenshot
directly, then fix what the image proves.

A screenshot judges what a surface *shows*, not whether it *works or makes
sense to use* — a static screenshot cannot click a fake expander or feel a
redundant flow. To judge an interface as an experience, drive it with the
explorative-testing skill and use this skill as its camera.

## Procedure

1. Start or identify the local server when the artifact needs one. For
   standalone HTML, a file URL is enough.
2. Take a screenshot of the relevant viewport with a bounded headless browser
   command.
3. Open the screenshot with the Read tool, which shows images.
4. Judge what is actually visible: framing, readability, overlap, empty states,
   contrast, content below the fold, responsive behavior, and missing assets.
5. When asked to fix, fix concrete visual defects and take the screenshot
   again; when asked only to judge, report the defects and change nothing.

Write screenshots to one scratch directory the session allows (`$SCRATCH` below).
`--screenshot` shows only the viewport: for a full page, raise the height in
`--window-size` to the page height (for example 4000); say in the report which
height was seen.

## Example Commands

The examples use `google-chrome`; substitute whichever Chromium-family binary
the machine has (`chromium`, `chromium-browser`, `headless_shell`) or an
installed Playwright browser.

Running page:

```bash
timeout -k 5 60 google-chrome --headless --disable-gpu \
  --hide-scrollbars --virtual-time-budget=4000 --window-size=1280,1400 \
  --screenshot="$SCRATCH/page.png" http://127.0.0.1:8000/
```

Phone width: the same command with `--window-size=390,844` and another file name.

Standalone HTML:

```bash
timeout -k 5 60 google-chrome --headless --disable-gpu \
  --window-size=1280,1000 --screenshot="$SCRATCH/page.png" \
  "file:///absolute/path/to/page.html"
```

Chrome's sandbox works for a non-root user; add `--no-sandbox` only where it
fails (root or a container), and only for trusted local content, since it
renders the page unsandboxed.

If the screenshot hangs or produces no image, stop the stale browser process
for that screenshot path before retrying with a bounded command.

## Output

Report what the screenshot shows, the concrete visual defects found (one line
each: where, what, and a verdict of ok or defect), and the verification
screenshot path. Do not claim a UI is visually correct unless you
looked at a rendered image.
