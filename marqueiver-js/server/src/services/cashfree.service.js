import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Cashfree integration (replaces Razorpay). Two separate Cashfree products:
 *  - Payment Gateway (Orders API) — brand pays INTO escrow.
 *  - Payouts (direct transfer) — creator WITHDRAWS from their internal wallet.
 *
 * Marqueiver's own backend is the escrow/wallet ledger (see models/Wallet.js,
 * models/Transaction.js) — Cashfree only ever moves real money in two places:
 * (1) brand → escrow order payment, (2) wallet → creator's bank/UPI on
 * withdrawal. Everything in between (escrow hold, release, wallet balance)
 * is an internal ledger entry, not a Cashfree call.
 *
 * Mock fallback: when INTEGRATION_MODE=mock or no client id is configured,
 * every function below returns a deterministic fake result so the full
 * escrow → wallet → withdrawal flow is testable without real credentials.
 */

const PG_BASE = () => (env.cashfree.mode === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg');
const PAYOUT_BASE = 'https://payout-api.cashfree.com/payout/v1'; // Cashfree Payouts is a single (prod) endpoint; sandbox uses test credentials on the same host.

function isLive() {
  return env.integrationMode === 'live' && !!env.cashfree.clientId && !!env.cashfree.clientSecret;
}

function pgHeaders() {
  return {
    'Content-Type': 'application/json',
    'x-client-id': env.cashfree.clientId,
    'x-client-secret': env.cashfree.clientSecret,
    'x-api-version': env.cashfree.apiVersion,
  };
}

/** Create a Cashfree Order for the brand to pay escrow into (Payment Gateway). */
export async function createEscrowOrder(dealId, amount, customer = {}) {
  if (!isLive()) {
    logger.info(`💳 [MOCK CASHFREE] escrow order for deal=${dealId} amount=₹${amount}`);
    return { orderRef: `mock_order_${dealId}_${Date.now()}`, gateway: 'mock', amount, paymentSessionId: 'mock_session' };
  }
  const orderId = `escrow_${dealId}_${Date.now()}`;
  const res = await fetch(`${PG_BASE()}/orders`, {
    method: 'POST',
    headers: pgHeaders(),
    body: JSON.stringify({
      order_id: orderId,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: customer.userId || `user_${dealId}`,
        customer_phone: customer.phone || '9999999999',
        customer_email: customer.email || undefined,
      },
      order_meta: {
        return_url: `${env.clientUrl}/deals/${dealId}?payment=return`,
        notify_url: `${env.apiUrl}/api/payments/webhook`,
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Cashfree order creation failed: ${json?.message ?? res.status}`);
  return { orderRef: json.order_id, gateway: 'cashfree', amount, paymentSessionId: json.payment_session_id };
}

/** Refund a Cashfree order (brand-side, e.g. cancelled/disputed deal). */
export async function refundToBrand(orderRef, amount) {
  if (!isLive()) {
    logger.info(`↩️  [MOCK CASHFREE] refund ₹${amount} for order ${orderRef}`);
    return { refundRef: `mock_refund_${Date.now()}`, status: 'success' };
  }
  const refundId = `refund_${orderRef}_${Date.now()}`;
  const res = await fetch(`${PG_BASE()}/orders/${orderRef}/refunds`, {
    method: 'POST',
    headers: pgHeaders(),
    body: JSON.stringify({ refund_amount: amount, refund_id: refundId, refund_note: 'Marqueiver escrow refund' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Cashfree refund failed: ${json?.message ?? res.status}`);
  return { refundRef: json.refund_id, status: json.refund_status === 'SUCCESS' ? 'success' : 'pending' };
}

/** Short-lived Payouts auth token (separate credential pair from the Payment Gateway). */
async function payoutToken() {
  const res = await fetch(`${PAYOUT_BASE}/authorize`, {
    method: 'POST',
    headers: {
      'X-Client-Id': env.cashfree.payoutClientId,
      'X-Client-Secret': env.cashfree.payoutClientSecret,
    },
  });
  const json = await res.json();
  if (!res.ok || json.status !== 'SUCCESS') throw new Error(`Cashfree payout auth failed: ${json?.message ?? res.status}`);
  return json.data.token;
}

/**
 * Withdraw from a creator's wallet to their bank account or UPI id
 * (Cashfree Payouts direct transfer — creates the beneficiary and transfers
 * in one call). Used by the Wallet module, not directly by the deal flow.
 */
export async function payoutToBeneficiary({ transferId, amount, name, phone, email, bankAccount, ifsc, vpa }) {
  if (!isLive() || !env.cashfree.payoutClientId) {
    logger.info(`💸 [MOCK CASHFREE PAYOUT] ₹${amount} → ${vpa || bankAccount} (${transferId})`);
    return { payoutRef: `mock_payout_${Date.now()}`, status: 'success' };
  }
  const token = await payoutToken();
  const res = await fetch(`${PAYOUT_BASE}/directTransfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      transferId,
      transferMode: vpa ? 'upi' : 'banktransfer',
      beneDetails: { name, phone, email, ...(vpa ? { vpa } : { bankAccount, ifsc }) },
    }),
  });
  const json = await res.json();
  if (!res.ok || (json.status !== 'SUCCESS' && json.status !== 'PENDING')) {
    throw new Error(`Cashfree payout failed: ${json?.message ?? res.status}`);
  }
  return { payoutRef: json.data?.referenceId ?? transferId, status: json.status === 'SUCCESS' ? 'success' : 'pending' };
}

/**
 * Verify a Cashfree webhook: HMAC-SHA256(timestamp + rawBody, clientSecret),
 * base64-encoded, compared against the x-webhook-signature header. Also
 * rejects stale timestamps (>5 min old) to prevent replay.
 */
export function verifyWebhook(rawBody, signature, timestamp) {
  if (env.integrationMode === 'mock') return true;
  if (!signature || !timestamp) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;
  const expected = crypto
    .createHmac('sha256', env.cashfree.clientSecret)
    .update(timestamp + rawBody)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
