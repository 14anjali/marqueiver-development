/**
 * Notification templates (feature: "notification queue/templates"). Centralises
 * the title/body copy for common events so every call site (deals, payments,
 * messaging) produces consistent text instead of ad-hoc strings scattered
 * across controllers. Each template is a small function returning
 * { title, body } from real event data — no fabricated content.
 */
export const templates = {
  dealInvited: (dealTitle) => ({
    title: 'New campaign invite',
    body: `You've been invited to "${dealTitle}".`,
  }),
  dealStateChanged: (dealTitle, state) => ({
    title: `Deal update: ${state.replace('_', ' ')}`,
    body: `"${dealTitle}" is now ${state.replace('_', ' ')}.`,
  }),
  escrowFunded: (dealTitle, amount) => ({
    title: 'Escrow funded',
    body: `₹${Number(amount).toLocaleString('en-IN')} has been secured in escrow for "${dealTitle}".`,
  }),
  escrowReleased: (dealTitle, amount) => ({
    title: 'Payment released',
    body: `₹${Number(amount).toLocaleString('en-IN')} has been released to you for "${dealTitle}".`,
  }),
  newMessage: (fromName) => ({
    title: 'New message',
    body: `${fromName} sent you a message.`,
  }),
  newReview: (rating) => ({
    title: 'New review',
    body: `You received a ${rating}-star review.`,
  }),
  verificationDecided: (kind, approved) => ({
    title: approved ? 'Verification approved' : 'Verification rejected',
    body: `Your ${kind} verification was ${approved ? 'approved' : 'rejected'}.`,
  }),
};
