# v0.13.3 — ownership details and new logo

## Ownership and contact
- Owner and developer: **GTN Global Network**, Arusha, Tanzania.
- Email: juniorlaban@gmail.com. Phone: +255 686 110 704.
- Copyright: © 2026 GTN Global Network. All rights reserved.

## Where it appears
- **Sign-in, first-run, lock and licence screens:** a plain two-line credit at the bottom: "© 2026 GTN Global Network. All rights reserved." and "Owner and developer: GTN Global Network".
- **Settings → About:** owner and developer, address, email, phone, version, copyright.
- **Sidebar:** a small copyright line at the bottom.
- **Installers:** publisher, copyright and description (Mac and Windows), `package.json` and `Cargo.toml` author, and a `COPYRIGHT.txt` notice.
- The details live in one file, `src/aboutInfo.ts`. A test fails if the installer and package files stop matching it. To change a detail later, edit that file and the matching lines in `tauri.conf.json`, `package.json`, `Cargo.toml` and `COPYRIGHT.txt`.

## Logo
The plain "M" tile is replaced everywhere (sidebar, sign-in, first run, lock, licence, loading and error screens) with the app-icon artwork: a white M standing on a foundation line, on a green rounded square, drawn as vector art so it stays sharp on Mac and Windows.

## Changed from v0.13.2
v0.13.2 credited an individual as developer and had no address. The owner and developer is now GTN Global Network, and the address is added.
