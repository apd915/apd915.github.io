# apd915.github.io

My portfolio site. It's plain HTML and CSS with no build step: edit a file, push it, done.

## Files

| File | What it is |
|---|---|
| `index.html` | Home / About: bio, stats, selected research, experience, education, skills |
| `research.html` | Research projects, publications, and presentations |
| `research/*.html` | Full write-ups (COAST, Self-Clearing Channels) linked from research cards |
| `projects.html` | Independent and course projects |
| `css/style.css` | All styling. Change `--accent` at the top to change the color |
| `images/` | Headshot and figures (`images/coast/`, `images/channels/`) |
| `files/CV.pdf` | CV (all "CV" links point here; replace the file to update it) |

## Adding a project

Copy an `<article class="project">…</article>` block in `research.html` or `projects.html` and edit it.
For a picture, put the file in `images/` and replace the `<div class="placeholder">…</div>` with
`<img class="thumb" src="images/your-photo.jpg" alt="Short description">`.

For a full write-up page, copy `research/coast.html`, edit it, and link to it from the card.
Pages in `research/` use `../` in front of every path.

## Publishing

```
git add -A
git commit -m "Describe the change"
git push
```

GitHub Pages serves https://apd915.github.io about a minute after each push.

## Footer date

Every page footer says "Last updated <Month Year>". When you change the site, update it everywhere at once, e.g.:

    sed -i "s/Last updated November 2026/Last updated December 2026/" *.html research/*.html projects/*.html
