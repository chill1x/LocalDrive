# LocalDrive — English

[Русская версия](README.ru.md) | [Main page](README.md)

LocalDrive is a self-hosted file manager for devices on your private local network. Files are not uploaded to a cloud service.

## Quick start (Windows 10/11)

1. Install Node.js 22 or newer if it is not already installed.
2. Open the project folder and double-click `start.bat`. Do not run it as administrator.
3. On first launch, wait for dependencies to install and the application to build. Keep the console window open while using LocalDrive.
4. Open the address printed in the console. On a phone or another PC, use that same address while connected to the same private Wi-Fi/LAN.
5. Sign in as `root` with the password you set locally using `npm run set-password` (enter the command in a terminal opened in the project folder). Passwords must be at least 10 characters; input is hidden. Restart the server after changing the password.

## Windows autostart

Double-click `autostart.bat` to add a shortcut to the current Windows user's Startup folder. To remove it, open a terminal in the project folder and run `autostart.bat /remove`. Administrator rights are not required.

## Settings and usage

- Open **Settings → Appearance** to choose light/dark/system mode and an interface accent color. The accent is saved in this browser on this device.
- Use **Settings → Server** or the console address to connect other devices.
- Limit exposed drives with `ALLOWED_ROOTS` in your private `.env` if you do not want to share every detected volume.
- `start.bat` automatically pauses LocalDrive while CS2/Dota 2 is running and resumes it after the game exits.

## Important: what NOT to do

- **Do not use `1234`**: it is trivial to guess. Choose a unique password with at least 10 characters.
- Do not publish or share `.env` or the `data/` directory; they contain the password hash and session secrets.
- In the Windows Firewall prompt, allow access only on **Private networks** and only on a trusted home network. Do not allow **Public networks**.
- Do not create router port forwarding or expose this server to the internet. It is an HTTP service intended for a trusted local network.
- Do not set `HOST=0.0.0.0` unless you understand that the server will listen on every network interface.
- Do not delete or rename files unless you are certain: file deletion in the app is permanent. Check the selected path and confirm only the intended operation.
- Do not run as administrator; the application does not need elevated privileges.

## Development and verification

`npm run build` type-checks and builds the application. `npm run smoke-test` exercises local file operations; run it only if you understand that it creates and deletes a temporary folder in Downloads. The host address, firewall scope, `.env` settings, upload behavior, and troubleshooting are described in the repository's [OPTIMIZATION.md](OPTIMIZATION.md) and source README history.
