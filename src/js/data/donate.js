/* ==================================================================
 * Donation channels — the single source of truth for "Support Zaferon Schemer".
 *
 * PUBLIC addresses only. NEVER put a private key, seed phrase, or wallet
 * password in this file — it ships inside the app bundle.
 *
 * Two kinds of entry are hidden or flagged, and the distinction matters:
 *
 *   · PLACEHOLDER — any entry whose `address` or `url` contains the
 *     substring `PLACEHOLDER` is treated as "not configured yet" and is
 *     hidden from every piece of UI. Use it for a channel you intend to
 *     add later without shipping a broken button now.
 *
 *   · demo: true — a fake-but-well-formed address that IS shown, so the
 *     dialog can be reviewed end to end before real details exist. It is
 *     captioned everywhere it appears.
 *
 * ⚠️ BEFORE PUBLIC RELEASE: delete every `demo: true` entry (or replace
 * its address with the real one and remove the flag). A shipped demo
 * address sends someone's money into the void.
 *
 * The support dialog reads these arrays at DIALOG-OPEN TIME and derives the
 * QR from the address string. There is no cache and no second copy of any
 * address anywhere in the app — edit the string here and the next open
 * renders a different QR.
 * ================================================================== */
(function () {
  'use strict';

  const CS = (window.CS = window.CS || {});

  /* An entry is "not configured" when its identifying string still carries
   * the PLACEHOLDER marker. Checked on both fields because a wallet has an
   * address and a link has a url. */
  const MARKER = 'PLACEHOLDER';

  function isReady(entry) {
    if (!entry) return false;
    const addr = entry.address || '';
    const url = entry.url || '';
    if (!addr && !url) return false;
    return addr.indexOf(MARKER) === -1 && url.indexOf(MARKER) === -1;
  }

  const wallets = [
    {
      id: 'usdt-trc20',
      label: 'Tether (USDT)',
      network: 'TRON network · TRC20',
      address: 'TJupoUwfAs9Dwm1TafvJeAH7BuhHVKiMeK',
      explorer: 'https://tronscan.org/#/address/TJupoUwfAs9Dwm1TafvJeAH7BuhHVKiMeK'
    }
  ];

  const links = [
    {
      id: 'rial',
      label: 'Rial support (Iran)',
      url: 'https://idpay.ir/PLACEHOLDER'
    }
  ];

  CS.Donate = {
    wallets,
    links,
    isReady,

    /** Wallets that are configured and may be shown. */
    readyWallets() {
      return wallets.filter(isReady);
    },

    /** Links that are configured and may be shown. */
    readyLinks() {
      return links.filter(isReady);
    },

    /** True when at least one channel of either kind is showable. */
    ready() {
      return this.readyWallets().length > 0 || this.readyLinks().length > 0;
    },

    /** True when any *visible* entry is still a demo — drives the warn note. */
    hasDemo() {
      return this.readyWallets().some((w) => !!w.demo);
    }
  };
})();
