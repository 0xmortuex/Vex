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

module.exports = { BRANDS };
