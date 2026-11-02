# EH Reader

A userscript that turns **E-Hentai** and **ExHentai** into a clean, phone-friendly app in Safari on iPhone and iPad. No App Store, no sideloading and no Mac needed. It runs in the free **Userscripts** Safari extension, and also works on desktop browsers with Tampermonkey or Violentmonkey.

It's inspired by [EhViewer](https://github.com/xiaojieonly/Ehviewer_CN_SXJ), the Android app, and brings many of its features to iOS.

> **18+ only.** E-Hentai and ExHentai host adult content. This project is not affiliated with, endorsed by, or connected to E-Hentai or ExHentai in any way. It only changes how the sites' own pages look and behave in your browser.

---

## Features

### Browsing
- **Mobile gallery lists:** large cover cards with title, uploader, rating stars, page count, category colour, language and date, for Front Page, Watched, Popular, Favorites, search results, tags and uploaders.
- **Infinite scroll:** more results load as you scroll, instead of using page numbers.
- **Comes back to where you were:** open a gallery, go back, and you're on the same spot in the list.
- **Back to top** button once you've scrolled down.
- **Slide-out menu** with all the site's sections, History, switching between E-Hentai and ExHentai, and settings.
- **Swipe gestures:** swipe right across the middle of the screen for the menu, and left for saved searches. Swipes from the screen edge are left to Safari's back gesture. Can be turned off.

### Searching
- **Search the section you're in:** Front Page, Watched or Favorites.
- **Filters:** include or exclude categories, choose a language, and set a minimum rating. Filters stay on until you change them.
- **Saved searches:** keep your favourite searches one tap away with the ☆ button.

### Galleries
- **Gallery page:** cover, titles, uploader, rating, category, language, page count and date, plus Tags and Comments sections you can expand.
- **Tags you can tap** to search them.
- **Thumbnails** two to a row with page numbers, loading as you scroll. Tap one to start reading from that page.
- **Favorites:** add, move or remove a gallery in a panel that shows your own category names, with an optional note. You stay on the gallery page.
- **Favorites categories:** switch between All and categories 0–9 from the Favorites heading.

### Reader
- **Scroll mode** (one long strip) or **paged mode** (tap or swipe to turn pages), with **right-to-left** for manga.
- **Preloads** the next pages, nearest first, without hammering the site.
- **Page slider** with a page-number preview while you drag.
- **Resumes** where you left off in every gallery.
- **Loading status** on each page: queued, finding image, downloading.
- **Landscape layout** with the controls in a slim side rail, kept clear of the image.
- One swipe up hides Safari's toolbar for a full-screen view.

### Your account
- **My Tags:** a mobile version of the site's page for watching or hiding tags, with colours, weights, tag sets, a filter box, and add, edit and delete.
- **History:** your last 200 galleries across both sites, with reading progress. Can be switched off, which also deletes it.
- **ExHentai sign-in:** sign in on the E-Hentai forums as usual and the script carries your login over to ExHentai. Your account still has to be eligible for ExHentai.
- **Skip content warnings** automatically for the current session. Can be turned off.

### Looks
- Three styles: **Classic** (red and black), **Midnight** (purple and black) and **Retrowave** (neon pink and cyan).
- **Classic site layout** is one tap away in the menu if you ever need the original pages, with an **EH Reader** button to switch back.

---

## Install

### iPhone / iPad (Safari)
1. Install **[Userscripts](https://apps.apple.com/app/userscripts/id1463298887)** from the App Store. It's free and open source, by Justin Wasack.
2. Open the Userscripts app once and choose a folder for your scripts.
3. Go to **Settings → Apps → Safari → Extensions → Userscripts**. Turn it on and allow it on **e-hentai.org**, **forums.e-hentai.org** and **exhentai.org**.
4. In Safari, open this link and tap **Install** when Userscripts offers it:
   **https://raw.githubusercontent.com/caaaw/Eh-Reader-IOS/main/eh-reader-IOS.user.js**
5. Visit [e-hentai.org](https://e-hentai.org). The mobile layout should appear.

If the install prompt doesn't appear, download `eh-reader-IOS.user.js` from this repository and save it into the Userscripts folder you chose in step 2. Use the Files app or iCloud Drive.

Once installed, the script **updates itself**: Userscripts checks this repository for new versions.

### Desktop (Chrome, Edge, Firefox)
1. Install **Tampermonkey** or **Violentmonkey**. In Chrome and Edge, Tampermonkey needs **Allow user scripts** turned on in its extension details.
2. Open the install link above and confirm.

---

## Getting started
- **☰** opens the menu. **☆** opens saved searches. The **funnel** opens search filters.
- Tap a gallery, then **Read**. Tap the middle of the page to show or hide the reader's controls.
- For ExHentai, sign in at [forums.e-hentai.org](https://forums.e-hentai.org) first, open any e-hentai.org page, then go to exhentai.org. If ExHentai still shows a blank page or a "sad panda", open **☰ → ExHentai sign-in** for help and manual options.
- Settings are at the bottom of the menu: **History**, **Skip content warnings**, **Swipe gestures** and **Style**.

---

## Privacy
- Everything the script remembers stays **on your device**, in your browser or the Userscripts app: History, saved searches, reading positions, filters, style and your ExHentai sign-in details.
- The script only talks to **e-hentai.org**, **exhentai.org** and the sites' own API (**api.e-hentai.org** / **s.exhentai.org**). Nothing is sent anywhere else, and there's no tracking.
- Turning **History** off deletes it.

---

## Troubleshooting
- **Nothing changed on the site:** check that Userscripts is turned on for the site (step 3), then reload the page.
- **Everything looks tiny:** open the menu and check the width shown at the bottom. On a phone in portrait it should be about 375–430px. If it isn't, please open an issue.
- **Something broke after the site changed:** use **☰ → Use classic site layout** in the meantime, and please open an issue with a screenshot.

---

## Contributing
Issues and pull requests are welcome. If something doesn't work, a screenshot and your device and iOS version help a lot.

## License
[MIT](LICENSE)
