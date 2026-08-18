// Loads the Cashfree Checkout JS SDK on demand (not bundled — it's a
// third-party payment script that should come straight from Cashfree's CDN,
// same reasoning most payment gateways require). Hardcoded to sandbox mode —
// going live would need a real Cashfree merchant account, which is out of
// scope for this pass (per instruction: skip production setup).
let cashfreeInstance = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load the Cashfree payment SDK'));
    document.head.appendChild(el);
  });
}

async function getCashfree() {
  if (cashfreeInstance) return cashfreeInstance;
  await loadScript('https://sdk.cashfree.com/js/v3/cashfree.js');
  if (!window.Cashfree) throw new Error('Cashfree SDK failed to initialize');
  cashfreeInstance = window.Cashfree({ mode: 'sandbox' });
  return cashfreeInstance;
}

/**
 * Opens the Cashfree hosted checkout as a modal for the given payment
 * session, and resolves once the modal closes. Resolves `{ ok: true }` on a
 * completed payment, `{ ok: false, message }` otherwise — never throws for a
 * normal decline/cancel, only for real SDK/network failures.
 */
export async function openCashfreeCheckout(paymentSessionId) {
  const cashfree = await getCashfree();
  const result = await cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' });
  if (result?.error) {
    return { ok: false, message: result.error.message || 'Payment was not completed' };
  }
  return { ok: true };
}
