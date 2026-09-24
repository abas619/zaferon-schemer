# Zaferon Schemer

A desktop colour studio: a harmony wheel, live schemes, a mixer, variations, photo colour extraction and a
full-screen eyedropper — **fully offline**. No account, no telemetry, no network access of any kind.

Zaferon (زعفران) is Persian for saffron — the colour the app opens on.

<p align="center">
  <img src="media/matching.png" alt="Matching Colors: the harmony wheel over the base colour, the base-colour sliders and the colour palette strip" width="760"><br>
  <b>Matching Colors</b> — set a base colour, then read every harmony off the wheel.
</p>

<p align="center">
  <img src="media/builder.png" alt="SchemeBuilder: harmony, shade, tint and tone suggestions for the base colour, and the scheme being assembled" width="760"><br>
  <b>SchemeBuilder</b> — every harmony, tint, shade and tone of the base colour, one click to add it.
</p>

## Features

- **Matching Colors** — a base-colour wheel over 16 harmony schemes (complements, analogues, triads, tetrads
  and friends), plus RGB / HSV / Spec / Convert tabs and a tone row that nudges brightness and saturation.
- **LiveSchemes** — up to eight handles you drag around a hue ring; the scheme and the palette strip update as
  you move them.
- **Color Mixer** — blend two colours by weight, with drag-and-drop from any swatch in the app.
- **Variations** — tints, shades and tones of the current colour, generated as a grid.
- **PhotoSchemer** — extract a palette from an image, with quantisation and per-region sampling.
- **SchemeBuilder, Gallery and SchemeBrowser** — arrange palettes by hand, or start from bundled schemes.
- **Screen eyedropper (F3)** — freezes the desktop full-screen with a loupe on the cursor; click any pixel on
  any monitor to sample it, Esc to cancel.
- **Colour-vision simulation** — protanopia, deuteranopia and tritanopia plus their anomalous variants,
  achromatopsia and grayscale.
- **Contrast analyzer (Ctrl+A)** — WCAG ratios between the current colour and any favourite.
- **Named-colour libraries** — HTML, Material, Classic, Utility and Retro, searchable.
- **Export and import** — Adobe Swatch Exchange (.ase), palette files, and whole workspaces.
- **Light and dark themes**, a persistent workspace, and undo/redo of colour history.
- **Nothing phones home.** The renderer runs under a `script-src 'self' file:` CSP and issues no requests; the
  QR codes in the Support dialog are generated locally. `Help ▸ Check for Updates…` therefore points at the
  [releases page](https://github.com/abas619/zaferon-schemer/releases) instead of pretending to poll a server.

## Download

Grab a packaged build from
**[Releases](https://github.com/abas619/zaferon-schemer/releases)**.

## Run from source

```bash
git clone https://github.com/abas619/zaferon-schemer.git
cd zaferon-schemer
npm install
npm start
```

Electron 33 and plain JavaScript — there is no bundler, no framework and no build step for the renderer, so
editing a file in `src/` and reloading the window is the whole development loop. `npm run` lists the test
harnesses that cover the parts a screenshot cannot show.

## Support the project

Zaferon Schemer is free and offline. If it is useful to you, you can say so — every channel below is also
available in-app as **Help ▸ Support Zaferon Schemer…**, where each address comes with a scannable QR code and
a Copy button.

| Channel | Address |
|---|---|
| Tether (USDT) — TRON network · TRC20 | `TJupoUwfAs9Dwm1TafvJeAH7BuhHVKiMeK` |

**Public receive addresses only.** No one from this project will ever ask for your private key, seed phrase or
wallet password — anyone who does is not us.

## Licence

[MIT](LICENSE) — © 2026 Abbas (abas619).
