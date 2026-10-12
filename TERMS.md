# Vex terms of use

Document version: 2
Last updated: 2026-10-11

These terms cover the Vex browser for Windows, made by 0xmortuex and published at https://github.com/0xmortuex/Vex. If you do not agree to them, do not use Vex.

## 1. Agreeing to these terms

The first time you start Vex, it shows a short list of what it does by itself and links to these terms and the privacy policy ([PRIVACY.md](https://github.com/0xmortuex/Vex/blob/main/PRIVACY.md)). You can read both inside Vex. Vex can only be used after you press **I agree**. **Quit Vex** closes it without agreeing.

When a new version of these terms or the privacy policy is published with a Vex update, Vex shows the same screen again once, with a short list of what changed, and asks you to agree again. Settings › About shows which version you accepted and when.

## 2. The licence

Vex is free and open-source software under the MIT License (see the LICENSE file that comes with Vex). You may use, copy, change and share it under that licence. Parts of Vex are made by other people and come under their own licences; see the third-party notices that come with Vex. If these terms and a licence ever disagree, the licence wins for the code it covers.

## 3. No warranty

Vex is provided **"as is"**, without any warranty of any kind, express or implied, including the warranties of merchantability, fitness for a particular purpose and non-infringement. To the fullest extent the law allows, the author is not liable for any claim, damage, data loss or other harm that comes from using Vex or not being able to use it.

Keep your own copies of anything important. Vex makes backups of your profile before updates, but a backup is not a promise that nothing can be lost.

## 4. What Vex does by itself

Some Vex features work without a click each time: they check for updates, download block lists, watch pages, read sign-in codes from your webmail tabs, keep indexes of what you read, and so on. Each one is listed in the privacy policy with what it sends, where, when, and how to turn it off. By agreeing, you accept that these features work as described there while they are on. Turning a feature off stops it, as described there.

## 5. Using Vex lawfully

You are responsible for how you use Vex and for following the laws that apply to you. In particular:

- **Tor.** Vex can download Tor and open private tabs through the Tor network. Tor is legal in most places but restricted in some. Check your local law before you use it.
- **Network bypass for Discord and Roblox (Light mode, ByeDPI).** These change how your traffic looks so that network blocks do not catch it. Using them may break the rules of your network, school, employer or internet provider, or local law. The Discord panel's "Light" mode (encrypted DNS lookups through Cloudflare and a split TLS greeting, for the Discord panel only) is on by default and is applied every time Vex starts; you can set it to Off in Settings › Privacy Hardening › "Discord and Roblox block bypass". ByeDPI ("Strong") is used only if you turn it on yourself, and then starts again each time Vex starts until you turn it off. Vex does not download or run zapret; it only mentions it.
- **Vencord.** Vex can download Vencord, a third-party Discord client mod, when you ask it to. Client mods may break Discord's terms of service, and Discord may act against your account. Use it at your own risk.
- **Page Watch and other checks you set up.** Page Watch visits the pages you choose on the schedule you set, and can also watch devices on your own home network (such as a router or a printer page). Only watch pages and devices you are allowed to access, and respect each site's rules and rate limits.
- **Email-code autofill and the Mail panel.** These read your own email to fill sign-in codes or show your inbox. Use them only with accounts that are yours.
- **Extensions.** Extensions you install come from other people. Vex does not review them. They run with the permissions you give them, and Vex keeps them up to date automatically unless you turn that off (an update that asks for more permissions waits for you).
- **Downloads and websites.** What you download and which sites you visit are up to you. Vex's safety checks (such as link warnings and the ad and tracker blocker) help, but they do not catch everything.
- **Automation and AI agent.** If you let the AI agent click and type on websites for you, or schedule tasks that run it, you are responsible for what it does in your name, and for following each site's rules.

## 6. Services you connect to

Vex itself does not come connected to any server run by the author. The cloud features only work after you add a server address:

- **Vex Sync** and **cloud AI** run on Cloudflare Workers that you deploy yourself (see SELF_HOSTING.md in the Vex repository), or that someone else runs and gives you the address for.
- Whoever runs that server is responsible for it. If the author runs a server and lets you use it, it is a free, best-effort service: there is **no promise that it will be available, keep your data, or keep working**. It can be changed, limited or shut down at any time, with or without notice. Keep a local copy of anything you care about.
- **Keep your Sync recovery code safe.** Synced data is encrypted with a key only your devices have. If you lose every device and the recovery code, nobody can recover your synced data, including the server's operator.
- **AI answers can be wrong.** They can be out of date, incomplete or made up. Do not rely on them for medical, legal, financial or safety decisions without checking.
- Search engines, websites, mail servers, extension stores and other services you use through Vex have their own terms, and you must follow them.

## 7. DRM and streaming

Vex can play protected video and music (for example Netflix or Spotify) using the Widevine Content Decryption Module from Google, delivered through castLabs Electron. That playback is controlled by the content provider and by Google. Their terms apply, and they can refuse playback at any time. Do not use Vex to get around copy protection.

## 8. Updates

Vex checks GitHub for new versions when it starts and every 6 hours while it is open, unless you turn off "Check for updates automatically" in Settings › About. It installs an update only when you choose to. Updates may add, change or remove features. You can choose the update channel in Settings › About.

## 9. Privacy

How Vex handles your data is described in the privacy policy ([PRIVACY.md](https://github.com/0xmortuex/Vex/blob/main/PRIVACY.md)), which comes with Vex and can be opened from Settings › About.

## 10. Changes to these terms

These terms may change. Each version has a document version number and a "Last updated" date at the top. A Vex update that brings a new version asks you to agree to it before you go on using Vex; until you agree, the version you accepted earlier applies. The history of every change is visible in the Vex repository on GitHub.

## 11. Contact

Questions, problems or reports: open an issue at https://github.com/0xmortuex/Vex/issues.
