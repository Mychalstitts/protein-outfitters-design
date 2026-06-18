// /api/_lib/sms.js — provider-agnostic transactional SMS helper.
//
// INERT BY DEFAULT. sendSms() sends nothing unless SMS is fully configured via
// environment variables, so it is safe to wire into the notification pipeline
// before a provider is chosen. Once configured, it is a complete Twilio sender
// with no extra dependencies (uses Twilio's REST API directly).
//
// To enable (set in Vercel → Production AND Preview, per our env convention):
//   SMS_PROVIDER=twilio
//   TWILIO_ACCOUNT_SID=AC...
//   TWILIO_AUTH_TOKEN=...
//   TWILIO_FROM=+1XXXXXXXXXX        ← an A2P 10DLC-registered number or
//                                     Messaging Service SID (MG...)
//
// NOTE: U.S. application-to-person business SMS also requires A2P 10DLC brand
// + campaign registration with the carrier before delivery will work. That is
// an account/compliance step on Twilio, independent of this code.

export function smsEnabled() {
  return process.env.SMS_PROVIDER === 'twilio'
    && !!process.env.TWILIO_ACCOUNT_SID
    && !!process.env.TWILIO_AUTH_TOKEN
    && !!process.env.TWILIO_FROM;
}

// Light E.164-ish normalization for US numbers; returns null if it can't.
export function normalizePhone(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.length >= 11 ? d : null;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return null;
}

export async function sendSms({ to, body }) {
  if (!smsEnabled()) return { sent: false, reason: 'sms_not_configured' };
  const phone = normalizePhone(to);
  if (!phone || !body) return { sent: false, reason: 'missing_or_invalid_to_or_body' };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;

  const params = new URLSearchParams({ To: phone, Body: String(body).slice(0, 320) });
  // TWILIO_FROM may be a Messaging Service SID (MG...) or a phone number.
  if (from.startsWith('MG')) params.set('MessagingServiceSid', from);
  else params.set('From', from);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { sent: false, reason: `twilio_${r.status}`, detail: t.slice(0, 200) };
    }
    const data = await r.json().catch(() => ({}));
    return { sent: true, sid: data.sid || null };
  } catch (e) {
    return { sent: false, reason: 'network_error', detail: String(e?.message || e) };
  }
}
