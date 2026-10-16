// === Brands that are impersonated, as registrable domains ===================
//
// What the lookalike check (src/main/web-safety.js) measures a typed or
// clicked address against, besides the sites the person visits themselves.
// A site on this list is never flagged: the point is to catch somebody ELSE's
// domain dressed up as one of these. It is deliberately the names that
// phishing really copies - sign-in pages, banks, payment and shipping - and
// not a ranking of the web.
//
// Keep entries lower-case, a registrable domain (name + public suffix), and
// free of confusable twins: tests/main/webSafety.test.js proves no two
// entries share a skeleton, or one would flag the other.
const BRANDS = [
  // search, mail, cloud
  'google.com', 'gmail.com', 'youtube.com', 'microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com',
  'bing.com', 'apple.com', 'icloud.com', 'yahoo.com', 'aol.com', 'proton.me', 'protonmail.com', 'duckduckgo.com',
  'dropbox.com', 'box.com', 'onedrive.com', 'mega.nz', 'wetransfer.com', 'zoom.us', 'slack.com', 'notion.so',
  'atlassian.com', 'salesforce.com', 'adobe.com', 'oracle.com', 'ibm.com', 'cloudflare.com', 'godaddy.com', 'namecheap.com',
  // social and messaging
  'facebook.com', 'instagram.com', 'whatsapp.com', 'messenger.com', 'twitter.com', 'linkedin.com', 'pinterest.com',
  'reddit.com', 'tiktok.com', 'snapchat.com', 'telegram.org', 'discord.com', 'twitch.tv', 'tumblr.com', 'medium.com',
  'quora.com', 'vk.com', 'wechat.com', 'signal.org', 'skype.com', 'viber.com', 'line.me',
  // shopping
  'amazon.com', 'ebay.com', 'aliexpress.com', 'alibaba.com', 'walmart.com', 'target.com', 'bestbuy.com', 'etsy.com',
  'shopify.com', 'costco.com', 'homedepot.com', 'ikea.com', 'zalando.com', 'wish.com', 'temu.com', 'shein.com', 'rakuten.com',
  // payment and money
  'paypal.com', 'stripe.com', 'venmo.com', 'cash.app', 'wise.com', 'revolut.com', 'payoneer.com', 'skrill.com', 'westernunion.com',
  'visa.com', 'mastercard.com', 'americanexpress.com', 'discover.com', 'klarna.com', 'affirm.com',
  // banks and brokers
  'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'capitalone.com', 'usbank.com', 'pnc.com', 'schwab.com',
  'fidelity.com', 'vanguard.com', 'hsbc.com', 'barclays.co.uk', 'lloydsbank.com', 'santander.com', 'ing.com', 'deutsche-bank.de',
  'tdbank.com', 'rbc.com', 'scotiabank.com', 'commbank.com.au', 'robinhood.com', 'etrade.com', 'tdameritrade.com',
  // crypto
  'coinbase.com', 'binance.com', 'kraken.com', 'metamask.io', 'blockchain.com', 'crypto.com', 'ledger.com', 'trezor.io', 'opensea.io', 'uniswap.org',
  // streaming and games
  'netflix.com', 'spotify.com', 'disneyplus.com', 'hulu.com', 'hbomax.com', 'primevideo.com', 'steampowered.com', 'steamcommunity.com',
  'epicgames.com', 'roblox.com', 'playstation.com', 'xbox.com', 'nintendo.com', 'ea.com', 'ubisoft.com', 'blizzard.com',
  'riotgames.com', 'minecraft.net', 'itch.io', 'gog.com', 'battle.net',
  // dev and accounts
  'github.com', 'gitlab.com', 'bitbucket.org', 'npmjs.com', 'stackoverflow.com', 'docker.com', 'heroku.com', 'vercel.com',
  'netlify.com', 'digitalocean.com', 'azure.com', 'openai.com', 'anthropic.com', 'huggingface.co',
  'okta.com', 'auth0.com', '1password.com', 'lastpass.com', 'bitwarden.com', 'dashlane.com',
  // shipping and travel
  'ups.com', 'fedex.com', 'dhl.com', 'usps.com', 'royalmail.com', 'canadapost.ca', 'booking.com', 'airbnb.com', 'expedia.com',
  'uber.com', 'lyft.com', 'delta.com', 'united.com', 'aa.com', 'lufthansa.com', 'ryanair.com', 'emirates.com',
  // carriers and utilities
  'verizon.com', 'att.com', 'tmobile.com', 'comcast.com', 'xfinity.com', 'vodafone.com', 'orange.fr', 'telekom.de', 'spectrum.com',
  // government and identity
  'irs.gov', 'usa.gov', 'ssa.gov', 'canada.ca', 'ato.gov.au', 'europa.eu', 'login.gov', 'id.me',
  // knowledge and media
  'wikipedia.org', 'wikimedia.org', 'mozilla.org', 'nytimes.com', 'bbc.com', 'cnn.com', 'theguardian.com', 'weather.com',
  'imdb.com', 'zillow.com', 'indeed.com', 'glassdoor.com', 'craigslist.org', 'coursera.org', 'udemy.com', 'duolingo.com',
  // security vendors (often impersonated in "your PC is infected" pages)
  'norton.com', 'mcafee.com', 'kaspersky.com', 'avast.com', 'bitdefender.com', 'malwarebytes.com',
];

// === Turkey: official, bank, cargo, shopping and travel names =================
//
// What a Turkish phishing page copies: the e-Devlet sign-in (turkiye.gov.tr),
// the school and exam services (e-Okul on meb.gov.tr, ÖSYM results), the
// parcel "your package is held, pay a fee" pages, and the banks. Same rules as
// above: registrable domains, lower-case, no confusable twins. Each one is a
// domain the organisation itself publishes; the .gov.tr ones can only be
// registered by a public body, so they are the safest entries on the list.
//
// NOT VERIFIED LIVE (this list was written from knowledge, nothing was
// fetched). The ones marked "check" below are the ones I am least sure are the
// organisation's primary domain TODAY; a wrong entry only means a lookalike of
// it would not be caught, never a false alarm on an honest site.
const TR_BRANDS = [
  // public bodies (.gov.tr: registrable only by the state)
  'turkiye.gov.tr',    // e-Devlet
  'osym.gov.tr',       // ÖSYM (ais.osym.gov.tr, sonuc.osym.gov.tr)
  'meb.gov.tr',        // MEB (e-okul.meb.gov.tr)
  'yok.gov.tr',        // YÖK (yokatlas)
  'sgk.gov.tr', 'gib.gov.tr', 'ptt.gov.tr', 'mhrs.gov.tr', 'enabiz.gov.tr', 'nvi.gov.tr', 'egm.gov.tr', 'tcmb.gov.tr',
  'tcddtasimacilik.gov.tr',   // check: the TCDD ticket site is a subdomain of it
  // banks and payment
  'ziraatbank.com.tr', 'isbank.com.tr', 'garantibbva.com.tr', 'yapikredi.com.tr', 'akbank.com', 'halkbank.com.tr', 'vakifbank.com.tr',
  'denizbank.com', 'teb.com.tr', 'ing.com.tr', 'kuveytturk.com.tr', 'albaraka.com.tr', 'fibabanka.com.tr', 'sekerbank.com.tr',
  'odeabank.com.tr', 'enpara.com', 'papara.com', 'iyzico.com',
  'qnb.com.tr',        // check: QNB Finansbank moved from qnbfinansbank.com; confirm which the owner's bank uses
  'ininal.com',        // check
  // cargo and post
  'yurticikargo.com', 'araskargo.com.tr', 'mngkargo.com.tr', 'suratkargo.com.tr',
  'hepsijet.com',      // check
  // shopping, food, classifieds
  'hepsiburada.com', 'trendyol.com', 'n11.com', 'sahibinden.com', 'getir.com', 'yemeksepeti.com', 'ciceksepeti.com',
  'amazon.com.tr', 'migros.com.tr', 'a101.com.tr', 'boyner.com.tr', 'teknosa.com', 'mediamarkt.com.tr', 'vatanbilgisayar.com',
  // phone companies
  'turkcell.com.tr', 'turktelekom.com.tr',
  // travel and tickets
  'turkishairlines.com', 'flypgs.com', 'obilet.com', 'enuygun.com', 'biletix.com',
];

module.exports = { BRANDS: BRANDS.concat(TR_BRANDS), TR_BRANDS };
