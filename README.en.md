**[한국어](README.md)**

# jaegosilsa

A stocktaking website that organizes a POS Excel export, counts physical items with a barcode scanner, and compares them against current-store inventory.

## Goal

Run separate stocktakes in each user's PC browser without login. Distinguish signed source inventory from physical-count discrepancies and download the results as Excel.

## Acceptance Criteria

- [x] Import the fixed POS XLSX format using product name, option name, barcode and current-store inventory headers, preserving string barcodes and signed quantities.
- [x] Split regular product names into SKU and color; retain irregular names and original options with a review-needed flag.
- [x] Add one item per scan and support undoing or correcting mistaken counts.
- [x] Display physical count minus reference inventory separately from the original inventory sign.
- [x] Reject unknown barcodes without changing counts, show a warning, and request Korean “오류” speech with explicit unavailable/error status.
- [x] Restore each user's stocktake after refresh and download XLSX results matching the screen.
- [x] The user confirmed audible voice playback in their current environment.
- [x] Play one short beep only after a registered scan is successfully saved.
- Physical-scanner testing is excluded from this cycle at the user's explicit request because no scanner is available. Keyboard-style input support remains; hardware compatibility is unverified.

See `acceptance_criteria` in the [canonical specification](docs/harness/seed.yaml) and the [verification report](docs/harness/verification-report.md) for the complete criteria and evidence.

## Constraints

- Use only `현매장 재고` (current-store inventory); do not add warehouse or other-store quantities.
- Process and store product data in the browser, without transmitting it to a server.
- Exclude accounts, shared stocktakes, cross-PC sync, camera scanning and automatic updates to the external site.
- Clearing browser storage deletes local stocktakes. The user confirmed voice playback in the current environment; other audio configurations are not guaranteed.

## Status

The local application is implemented and runnable. See the [verification report](docs/harness/verification-report.md) for evidence. The user's voice confirmation is recorded, and physical-scanner testing is excluded from this cycle with explicit approval. Scanner hardware compatibility has not been verified.

## Running

Use Node.js 24+ and current Chrome/Edge with an installed Korean voice. Use the **음성 테스트** (voice test) button to check audible output first.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173`, select a POS `.xlsx` file, then scan into the barcode input. Enter or Tab registers one item.

```sh
npm test
npm run build
npm run preview
```

Production output is in `dist/`; preview runs at `http://127.0.0.1:4173`. Browser storage is origin-specific: development, preview, deployment, `localhost` and `127.0.0.1` do not automatically share records.

## Vercel Deployment Preparation

Only deployment configuration and app CI are prepared; no live publication, account creation or plan change has been performed. `app-ci` runs `npm ci`, `npm test` and `npm run build` with Node.js 24 on pushes to `main` and pull requests. It does not deploy.

### Setup After Explicit Publication Approval

1. Store/business use requires a [Vercel plan](https://vercel.com/docs/plans/hobby) compatible with commercial use. Hobby is limited to noncommercial personal use. Check eligibility, but do not purchase or upgrade without separate approval.
2. After publication is explicitly authorized, import the private GitHub repository `marahmik/jaegosilsa` into Vercel, granting only the required repository access. **Project import and the first Deploy can publish the site; do not treat import as harmless preparation.**
3. Set the project root to `.`, Framework Preset to **Vite**, Install Command to `npm ci`, Build Command to `npm run build`, Output Directory to `dist` and Node.js Version to **24.x**. Set Production Branch to `main`. See the [official Vite guide](https://vercel.com/docs/frameworks/frontend/vite).
4. `git.deploymentEnabled: false` in `vercel.json` disables automatic Git deployments for every branch. Change it to `true` and commit only after actual publication and subsequent automatic deployments are authorized, or retain `false` and perform an authorized manual deployment. This setting does not prevent import/manual deployment or unpublish an existing site. See [Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration).
5. The public service must work without an app login. After publication approval, also check Vercel deployment protection so visitors are not required to sign in to Vercel. A private repository does not make the deployed site private. Never commit account details or tokens. The app needs no environment variables for server data storage or product-file uploads.

Deploy static assets only, without functions or a blanket SPA rewrite. There are no client-side routes, so workers and static assets must be served at their actual file paths. POS files, products and stocktake records are processed/stored in the browser, not uploaded to a server.

### First Public Release Checklist

- At the authorized deployment URL, confirm that the XLSX import worker actually loads and that POS import and result XLSX download work.
- Listen for exactly one beep after a registered barcode is successfully saved. Unknown barcodes must leave counts unchanged and show a warning plus Korean “오류” speech or an explicit speech error status. Existing voice confirmation in the current environment is not proof of audible beeps in the deployed environment.
- Confirm restoration after refresh and visible storage/audio failure states. Physical-scanner testing remains waived for this acceptance cycle with the user's approval because no scanner is available; hardware compatibility is still unverified.
- Choose a stable production URL before starting a stocktake. Changing preview URL, domain, protocol or port changes the origin; records do not automatically migrate. **Export the result XLSX before changing origins or clearing browser data.** The export preserves results, but does not automatically restore stocktake state on another origin.


## Operational Boundaries

- Confirmed file replacement resets physical counts to zero. Download a current POS export before starting a stocktake to include new products.
- Manual corrections invalidate that product's earlier undo entries. Undo history is not restored after refresh.
- Downloads include every product regardless of current search/filter settings.
- Storage and speech failures are visible. Do not treat a failed save as committed.
- Input limits: 16 MiB XLSX, 100,000 products, 128 columns and 8,000,000 range cells. Oversized input is rejected, not truncated. These limits are not a ZIP decompression-memory guarantee.
- Concurrent counting from multiple tabs in the same browser is outside the supported workflow.
- Successful scans use a short beep; unknown input, failed saves, corrections and undo do not. Audio blocking is reported separately without undoing committed counts. The existing Korean error speech remains unchanged.
