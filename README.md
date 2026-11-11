# apd915.github.io

My portfolio site. It's plain HTML and CSS with no build step: edit a file, upload it, done.

## Files

| File | What it is |
|---|---|
| `index.html` | Home / About: bio, selected work, interests, education |
| `research.html` | Full project list |
| `blog.html` | List of blog posts |
| `blog/*.html` | Individual posts (copy `hello-world.html` to start a new one) |
| `css/style.css` | All styling. Change `--accent` at the top to change the color |
| `images/` | Headshot and project photos |
| `files/CV.pdf` | Your CV (the "CV" links point here) |

Search the HTML files for `TODO` to find everything that still needs your info.

## Adding a picture

1. Put the file in `images/`, e.g. `images/coast-flight.jpg`.
2. Replace the `<div class="placeholder">…</div>` with
   `<img class="thumb" src="images/coast-flight.jpg" alt="Quadrotor avoiding an obstacle">`.

## Previewing locally

Double-click `index.html` to open it in your browser.

## Publishing

Push to the `main` branch of the `apd915.github.io` repository. GitHub Pages serves it at
https://apd915.github.io within a minute or two.
