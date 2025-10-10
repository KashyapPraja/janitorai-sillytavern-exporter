# JanitorAI → SillyTavern Card Exporter

![Version](https://img.shields.io/badge/version-0.2.0-purple)
![License](https://img.shields.io/badge/license-MIT-yellow)
![Last Updated](https://img.shields.io/badge/last%20updated-2025--10--10-informational)

A Tampermonkey userscript that exports JanitorAI characters as SillyTavern-compatible Chara Card V2 PNGs. The script surfaces a floating action button on character pages, captures page data, embeds the JSON definition inside a PNG text chunk, and saves the file locally.

## Features

- **One-Click Export:** Adds a floating “Download SillyTavern Card” button to JanitorAI character pages.
- **Mirror Lookup:** Automatically searches the JannyAI mirror for official card downloads before falling back to page scraping.
- **Multi-Match Prompting:** If multiple JannyAI cards exist, prompts you to choose the correct one before downloading.
- **Rich-Text Cleanup:** Converts HTML descriptions, lists, and formatted content into clean multiline text.
- **Robust Data Extraction:** Walks Nuxt/Next payloads, embedded script JSON, and intercepted API responses to capture definitions.
- **PNG Card Builder:** Embeds the character JSON into a PNG `tEXt` chunk using the Chara Card V2 specification.
- **Image Heuristics:** Resolves avatar filenames, CDN paths, and nested image metadata to find the best portrait.
- **Fallback Artwork:** Generates a gradient placeholder image when no artwork is available.
- **Navigation Awareness:** Observes SPA route changes, ensuring the button appears on dynamically loaded pages.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Download the script file [janitorai-sillytavern-exporter.user.js](https://raw.githubusercontent.com/cwlum/janitorai-sillytavern-exporter/refs/heads/master/janitorai-sillytavern-exporter.user.js).
3. Open the file in your browser and allow Tampermonkey to install it.
4. Visit any JanitorAI character page—the exporter button should appear in the lower-right corner.

## Usage

1. Navigate to a JanitorAI character page (`janitorai.com` or `jannyai.com` mirror).
2. Click **Download SillyTavern Card**.
3. If a JannyAI-hosted card is found, it is downloaded directly. Multiple matches trigger a prompt to pick one.
4. If no hosted card exists, the script collects page data, embeds it into a PNG, and downloads the generated file.
5. Import the resulting PNG into SillyTavern as a standard V2 card.

## Configuration

The script currently has no end-user settings. You can tweak constants near the top of `janitorai-sillytavern-exporter.user.js` to adjust:

- Button text and positioning.
- JannyAI host list and search templates.
- CDN path heuristics and fallback artwork styling.

Tampermonkey allows enabling/disabling the script per site if needed.

## Troubleshooting

- **“Character data could not be located”**: Reload the page to let the network interceptors capture payloads, then click the button again.
- **Wrong character downloaded**: When prompted, pick the correct entry. Canceling skips the JannyAI download and uses the local export instead.
- **Missing avatar art**: The fallback image indicates the script could not resolve a portrait URL from the page or mirror data.
- **Button not visible**: Ensure you are on a character detail route (`/characters/...`) and that the userscript is enabled for the domain.

## Contributing

Issues and pull requests are welcome. Useful contributions include:

- Additional data field mappings.
- Improved CDN heuristics for avatar resolution.
- Localization of prompts or UI text.
- Documentation updates and usage tips.

## License

Released under the MIT License. See [`LICENSE`](../LICENSE) for full terms.

## Updates
<details>
<summary><strong>Changelog</strong> (Click to expand)</summary>
<hr/>

**v0.2.0**

- Added automatic lookup of matching cards on `jannyai.com` with prompt-based selection when multiple matches exist.
- Expanded CDN heuristics to resolve avatar filenames, nested media objects, and alternate storage paths.
- Normalized HTML-rich descriptions and greetings into clean plaintext for V2 card fields.
- Hardened network fetch helpers with credential-aware fallbacks.

**v0.1.0**

- Initial release with SPA-aware export button, Chara Card V2 PNG generator, and fallback artwork rendering.

</details>
