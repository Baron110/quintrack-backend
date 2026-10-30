const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
// Use an unpredictable fallback instead of a publicly known signing key.
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');

// ── MIDDLEWARE ──
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));

// ── RESEND ──
const resend = new Resend(process.env.RESEND_API_KEY);
console.log('✅ Resend configured');

// ── DB ──
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { console.error('❌ MongoDB error:', err); process.exit(1); });

// ── SCHEMAS ──
const journeyStopSchema = new mongoose.Schema({
  location: { type: String, required: true },
  country:  { type: String, default: 'OTHER' },
  type:     { type: String, enum: ['pickup','flight','transit','arrival','sort','delivery','delivered'], default: 'sort' },
  event:    { type: String, default: '' },
  date:     { type: String, default: '—' },
  dateRaw:  { type: String, default: '' },
  time:     { type: String, default: '—' },
  done:     { type: Boolean, default: false },
  active:   { type: Boolean, default: false }
}, { _id: false });

const shipmentSchema = new mongoose.Schema({
  ownerAdmin: { type: String, required: true, immutable: true, index: true },
  id:        { type: String, required: true, unique: true, index: true },
  status:    { type: String, enum: ['Pending','In Transit','Out for Delivery','Delivered'], default: 'Pending' },
  pct:       { type: Number, min: 0, max: 100, default: 0 },
  itemPhoto: { type: String, default: null },
  sender:    { name: String, address: String, city: String, zip: String, tel: String, email: String },
  receiver:  { name: String, address: String, city: String, zip: String, tel: String, email: String },
  package:   { content: String, qty: String, weight: String, from: String, orderType: String, shipDate: String, expDate: String },
  journey:   [journeyStopSchema],
  createdAt: { type: Date, default: Date.now }
});
const Shipment = mongoose.model('Shipment', shipmentSchema);

const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const Admin = mongoose.model('Admin', adminSchema);

// ── SEED ADMIN ──
async function seedAdmin() {
  const exists = await Admin.findOne({ username: process.env.ADMIN_USERNAME || 'admin' });
  if (!exists) {
    const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'quintrack2026', 10);
    await Admin.create({ username: process.env.ADMIN_USERNAME || 'admin', password: hashed });
    console.log('✅ Admin created');
  }
}
async function seedSecondAdmin() {
  if (!process.env.ADMIN2_PASSWORD) return;
  const username = process.env.ADMIN2_USERNAME || 'admin2';
  if (username === (process.env.ADMIN_USERNAME || 'admin')) throw new Error('Admin usernames must differ');
  const password = process.env.ADMIN2_PASSWORD;
  const admin = await Admin.findOne({ username });
  if (!admin) {
    await Admin.create({ username, password: await bcrypt.hash(password, 10) });
  } else if (!await bcrypt.compare(password, admin.password)) {
    admin.password = await bcrypt.hash(password, 10);
    await admin.save();
    console.log('Admin 2 password synchronized from environment');
  }
}
Promise.all([seedAdmin(), seedSecondAdmin()]).catch(err => { console.error('Admin setup failed:', err.message); process.exit(1); });

// ── AUTH ──
function authRequired(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    if (req.admin.purpose === 'shipment-chat') return res.status(401).json({ error: 'Admin login required' });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── CREATION EMAIL ──
async function sendTrackingEmail(shipment, trackingUrl) {
  const recipientEmail = shipment.receiver?.email;
  if (!recipientEmail) return;
  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';

  const statusMessages = {
    'Pending':          { subject: `Your Shipment ${shipment.id} Has Been Registered`, heading: 'Your shipment has been registered! 📋', body: `Hi <strong style="color:#111827;">${shipment.receiver?.name || 'there'}</strong>, your shipment has been registered and is being prepared for dispatch.` },
    'In Transit':       { subject: `Your Shipment ${shipment.id} Is Currently In Transit`, heading: 'Your shipment is on its way! 🚚', body: `Hi <strong style="color:#111827;">${shipment.receiver?.name || 'there'}</strong>, your shipment is currently in transit and being tracked in real-time.` },
    'Out for Delivery': { subject: `Your Shipment ${shipment.id} Is Out for Delivery!`, heading: 'Your shipment is out for delivery! 🏃', body: `Hi <strong style="color:#111827;">${shipment.receiver?.name || 'there'}</strong>, great news — your shipment is out for delivery and should arrive soon!` },
    'Delivered':        { subject: `Your Shipment ${shipment.id} Has Been Delivered`, heading: 'Your shipment has been delivered! ✅', body: `Hi <strong style="color:#111827;">${shipment.receiver?.name || 'there'}</strong>, your shipment has been successfully delivered. Thank you for using QUIN-TRACK.` },
  };

  const msg = statusMessages[shipment.status] || statusMessages['Pending'];

  try {
    const result = await resend.emails.send({
      from: `QUIN-TRACK Logistics <${fromEmail}>`,
      to: recipientEmail,
      subject: `${msg.subject} — QUIN-TRACK`,
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:'Inter',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#0a0f1e;padding:28px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-0.04em;line-height:1;">QUIN<span style="color:#3b82f6;">-TRACK</span></div>
                  <div style="height:2px;background:#3b82f6;width:80px;margin-top:5px;border-radius:1px;"></div>
                  <div style="font-size:9px;font-weight:700;letter-spacing:0.18em;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-top:4px;">Global Logistics</div>
                </td>
                <td align="right">
                  <div style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:99px;padding:6px 14px;display:inline-block;">
                    <span style="color:#60a5fa;font-size:11px;font-weight:700;">Shipment Confirmed</span>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px 0;">
            <h1 style="font-size:22px;font-weight:800;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">${msg.heading}</h1>
            <p style="color:#6b7280;font-size:15px;margin:0;line-height:1.6;">${msg.body}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border:1.5px solid #e0e7ff;border-radius:16px;">
              <tr>
                <td style="padding:24px;text-align:center;">
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#6b7280;margin-bottom:8px;">Tracking Number</div>
                  <div style="font-family:'Courier New',monospace;font-size:28px;font-weight:900;color:#111827;letter-spacing:0.05em;">${shipment.id}</div>
                  <div style="margin-top:10px;">
                    <span style="background:#eff6ff;color:#2563eb;border:1.5px solid #bfdbfe;border-radius:99px;padding:4px 14px;font-size:12px;font-weight:700;">${shipment.status}</span>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td style="padding:0 36px;"><div style="height:1px;background:#f3f4f6;"></div></td></tr>
        <tr>
          <td style="padding:24px 36px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;margin-bottom:16px;">Shipment Details</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;width:40%;">Contents</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#111827;">${shipment.package?.content || '—'}</td></tr>
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;">Weight</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#111827;">${shipment.package?.weight || '—'}</td></tr>
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;">From</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#111827;">${shipment.sender?.name || '—'}, ${shipment.sender?.city || ''}</td></tr>
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;">Ship Date</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#111827;">${shipment.package?.shipDate || '—'}</td></tr>
              <tr><td style="padding:10px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;">Expected</td><td style="padding:10px 0;font-size:14px;font-weight:700;color:#2563eb;">${shipment.package?.expDate || '—'}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;">
              <tr>
                <td style="padding:16px 20px;border-right:1px solid #e5e7eb;width:50%;vertical-align:top;">
                  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#2563eb;margin-bottom:8px;">📤 Sender</div>
                  <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:3px;">${shipment.sender?.name || '—'}</div>
                  <div style="font-size:12px;color:#6b7280;">${shipment.sender?.city || '—'}</div>
                </td>
                <td style="padding:16px 20px;width:50%;vertical-align:top;">
                  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#2563eb;margin-bottom:8px;">📥 Receiver</div>
                  <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:3px;">${shipment.receiver?.name || '—'}</div>
                  <div style="font-size:12px;color:#6b7280;">${shipment.receiver?.city || '—'}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 32px;">
            <a href="${trackingUrl}" style="display:block;background:#111827;color:#ffffff;text-align:center;padding:16px;border-radius:14px;font-size:15px;font-weight:700;text-decoration:none;">Track Your Shipment →</a>
            <p style="color:#9ca3af;font-size:12px;text-align:center;margin:12px 0 0;">Or copy: <a href="${trackingUrl}" style="color:#2563eb;word-break:break-all;">${trackingUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td><div style="font-size:13px;font-weight:900;color:#111827;letter-spacing:-0.03em;">QUIN<span style="color:#2563eb;">-TRACK</span></div><div style="font-size:11px;color:#9ca3af;margin-top:2px;">Reliable. Clear. Fast.</div></td>
                <td align="right"><div style="font-size:11px;color:#9ca3af;">© 2026 QUIN-TRACK Logistics</div></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    });
    if (result.error) {
      console.error('❌ Email error (Resend rejected it):', result.error.message || JSON.stringify(result.error));
    } else {
      console.log(`✅ Email sent to ${recipientEmail} (id: ${result.data?.id})`);
    }
  } catch (err) {
    console.error('❌ Email error:', err?.message);
  }
}

// ── STATUS UPDATE EMAIL ──
async function sendStatusUpdateEmail(shipment, trackingUrl) {
  const recipientEmail = shipment.receiver?.email;
  if (!recipientEmail) return;
  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  const statusColor = {'Pending':'#d97706','In Transit':'#2563eb','Out for Delivery':'#0891b2','Delivered':'#16a34a'}[shipment.status] || '#2563eb';
  try {
    const result = await resend.emails.send({
      from: `QUIN-TRACK Logistics <${fromEmail}>`,
      to: recipientEmail,
      subject: `Shipment Update: ${shipment.id} is now ${shipment.status} — QUIN-TRACK`,
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:'Inter',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e5e7eb;">
        <tr>
          <td style="background:#0a0f1e;padding:28px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-0.04em;line-height:1;">QUIN<span style="color:#3b82f6;">-TRACK</span></div>
                  <div style="height:2px;background:#3b82f6;width:80px;margin-top:5px;border-radius:1px;"></div>
                  <div style="font-size:9px;font-weight:700;letter-spacing:0.18em;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-top:4px;">Global Logistics</div>
                </td>
                <td align="right">
                  <div style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:99px;padding:6px 14px;display:inline-block;">
                    <span style="color:#60a5fa;font-size:11px;font-weight:700;">Status Update</span>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px 0;">
            <h1 style="font-size:22px;font-weight:800;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Your shipment status has changed!</h1>
            <p style="color:#6b7280;font-size:15px;margin:0;line-height:1.6;">Hi <strong style="color:#111827;">${shipment.receiver?.name || 'there'}</strong>, here's the latest update on your shipment.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;border:1.5px solid #e0e7ff;border-radius:16px;">
              <tr>
                <td style="padding:24px;text-align:center;">
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#6b7280;margin-bottom:6px;">Tracking Number</div>
                  <div style="font-family:'Courier New',monospace;font-size:22px;font-weight:900;color:#111827;letter-spacing:0.05em;margin-bottom:12px;">${shipment.id}</div>
                  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#6b7280;margin-bottom:8px;">Current Status</div>
                  <div style="display:inline-block;background:${statusColor};color:#fff;border-radius:99px;padding:8px 24px;font-size:15px;font-weight:700;">${shipment.status}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td style="padding:0 36px;"><div style="height:1px;background:#f3f4f6;"></div></td></tr>
        <tr>
          <td style="padding:24px 36px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;margin-bottom:16px;">Package Info</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;width:40%;">Contents</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#111827;">${shipment.package?.content || '—'}</td></tr>
              <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;">From</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#111827;">${shipment.sender?.name || '—'}, ${shipment.sender?.city || ''}</td></tr>
              <tr><td style="padding:10px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#9ca3af;">Expected</td><td style="padding:10px 0;font-size:14px;font-weight:700;color:#2563eb;">${shipment.package?.expDate || '—'}</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px 32px;">
            <a href="${trackingUrl}" style="display:block;background:#111827;color:#ffffff;text-align:center;padding:16px;border-radius:14px;font-size:15px;font-weight:700;text-decoration:none;">View Full Tracking Details →</a>
            <p style="color:#9ca3af;font-size:12px;text-align:center;margin:12px 0 0;"><a href="${trackingUrl}" style="color:#2563eb;word-break:break-all;">${trackingUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 36px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td><div style="font-size:13px;font-weight:900;color:#111827;letter-spacing:-0.03em;">QUIN<span style="color:#2563eb;">-TRACK</span></div><div style="font-size:11px;color:#9ca3af;margin-top:2px;">Reliable. Clear. Fast.</div></td>
                <td align="right"><div style="font-size:11px;color:#9ca3af;">© 2026 QUIN-TRACK Logistics</div></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    });
    if (result.error) {
      console.error('❌ Status email error (Resend rejected it):', result.error.message || JSON.stringify(result.error));
    } else {
      console.log(`✅ Status update email sent to ${recipientEmail} (id: ${result.data?.id})`);
    }
  } catch (err) {
    console.error('❌ Status email error:', err?.message);
  }
}

// ══════════════════
//  ROUTES
// ══════════════════

app.get('/', (req, res) => res.json({ status: 'QUIN-TRACK API running 🚚', version: '1.0.0' }));

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, admin.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, username });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

function shipmentOwnerFilter(req) {
  const username = req.admin.username;
  return username === (process.env.ADMIN_USERNAME || 'admin')
    ? { $or: [{ ownerAdmin: username }, { ownerAdmin: { $exists: false } }] }
    : { ownerAdmin: username };
}
function optionalAdminAuth(req, res, next) {
  if (req.headers.authorization) return authRequired(req, res, next);
  next();
}

// PUBLIC: GET single shipment (authenticated admins are restricted to their own jobs)
app.get('/api/shipments/:id', optionalAdminAuth, async (req, res) => {
  try {
    const shipment = await Shipment.findOne({ id: req.params.id.toUpperCase(), ...(req.admin ? shipmentOwnerFilter(req) : {}) }).select('-ownerAdmin').lean();
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
    if (!req.admin) {
      if (shipment.receiver) delete shipment.receiver.tel;
      if (shipment.sender) delete shipment.sender.tel;
    }
    res.json(shipment);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PROTECTED: GET all shipments
app.get('/api/shipments', authRequired, async (req, res) => {
  try {
    const { q } = req.query;
    const filter = q ? { $or: [
      { id: { $regex: q, $options: 'i' } },
      { 'sender.name': { $regex: q, $options: 'i' } },
      { 'receiver.name': { $regex: q, $options: 'i' } },
      { 'package.content': { $regex: q, $options: 'i' } }
    ]} : {};
    const shipments = await Shipment.find({ $and: [shipmentOwnerFilter(req), filter] }).sort({ createdAt: -1 }).lean();
    res.json(shipments);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PROTECTED: CREATE shipment + send email
app.post('/api/shipments', authRequired, async (req, res) => {
  try {
    const data = { ...req.body, ownerAdmin: req.admin.username };
    if (!data.id) data.id = genId();
    data.id = data.id.toUpperCase();
    const exists = await Shipment.findOne({ id: data.id });
    if (exists) return res.status(409).json({ error: 'Tracking ID already exists' });
    const shipment = await Shipment.create(data);
    const frontendUrl = process.env.FRONTEND_URL || 'https://quintrack-frontend.vercel.app';
    const trackingUrl = `${frontendUrl}/tracking-details.html?t=${shipment.id}`;
    sendTrackingEmail(shipment, trackingUrl);
    res.status(201).json(shipment);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PROTECTED: UPDATE shipment + send status email
app.patch('/api/shipments/:id', authRequired, async (req, res) => {
  try {
    const allowed = ['status', 'pct', 'itemPhoto', 'sender', 'receiver', 'package', 'journey'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key) || /^package\.(content|qty|weight|from|orderType|shipDate|expDate)$/.test(key)));
    const filter = { id: req.params.id.toUpperCase(), ...shipmentOwnerFilter(req) };
    const oldShipment = await Shipment.findOne(filter);
    const shipment = await Shipment.findOneAndUpdate(
      filter,
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
    if (oldShipment && req.body.status && req.body.status !== oldShipment.status) {
      const frontendUrl = process.env.FRONTEND_URL || 'https://quintrack-frontend.vercel.app';
      const trackingUrl = `${frontendUrl}/tracking-details.html?t=${shipment.id}`;
      sendStatusUpdateEmail(shipment, trackingUrl);
    }
    res.json(shipment);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PROTECTED: DELETE shipment
app.delete('/api/shipments/:id', authRequired, async (req, res) => {
  try {
    const result = await Shipment.deleteOne({ id: req.params.id.toUpperCase(), ...shipmentOwnerFilter(req) });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PROTECTED: STATS
app.get('/api/stats', authRequired, async (req, res) => {
  try {
    const [total, transit, delivered, pending] = await Promise.all([
      Shipment.countDocuments(shipmentOwnerFilter(req)),
      Shipment.countDocuments({ ...shipmentOwnerFilter(req), status: { $in: ['In Transit','Out for Delivery'] } }),
      Shipment.countDocuments({ status: 'Delivered' }),
      Shipment.countDocuments({ status: 'Pending' })
    ]);
    res.json({ total, transit, delivered, pending });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

function genId() {
  const l = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `QT-${Math.floor(1000 + Math.random() * 9000)}-${l()}${l()}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚚 QUIN-TRACK API on port ${PORT}`));

// ══════════════════
//  CHAT / SUPPORT
// ══════════════════

const chatSchema = new mongoose.Schema({
  shipmentId: { type: String, index: true },
  phoneKey: { type: String, select: false },
  sessionId:  { type: String, required: true, unique: true, index: true },
  assignedAdmin: { type: String, default: () => process.env.ADMIN_USERNAME || 'admin', index: true },
  userName:   { type: String, default: 'Guest' },
  userEmail:  { type: String, default: '' },
  messages:   [{
    role:      { type: String, enum: ['user','admin'], required: true },
    text:      { type: String, default: '' },
    image:     { type: String, default: null },
    timestamp: { type: Date, default: Date.now }
  }],
  unread:     { type: Number, default: 0 },
  resolved:   { type: Boolean, default: false },
  createdAt:  { type: Date, default: Date.now },
  updatedAt:  { type: Date, default: Date.now }
});
const Chat = mongoose.model('Chat', chatSchema);

function supportUsername(target) {
  return target === 'admin2' ? (process.env.ADMIN2_USERNAME || 'admin2') : (process.env.ADMIN_USERNAME || 'admin');
}
function adminChatFilter(req) {
  const username = req.admin.username;
  return username === supportUsername('admin') ? { $or: [{ assignedAdmin: username }, { assignedAdmin: { $exists: false } }] } : { assignedAdmin: username };
}
// Shipment chats require a matching receiver phone, then a short-lived signed token.
function normalizePhone(value) { return typeof value === 'string' ? value.replace(/\D/g, '') : ''; }
function chatPhoneKey(phone) {
  return crypto.createHmac('sha256', JWT_SECRET).update(phone).digest('hex');
}
const unlockAttempts = new Map();
app.post('/api/chat/session', async (req, res) => {
  const key = req.ip;
  const now = Date.now();
  for (const [ip, attempt] of unlockAttempts) if (attempt.until < now) unlockAttempts.delete(ip);
  const attempt = unlockAttempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  if (++attempt.count > 15) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  unlockAttempts.set(key, attempt);
  try {
    const { trackingId, phone, userName, userEmail } = req.body;
    const normalized = normalizePhone(phone);
    if (typeof trackingId !== 'string' || normalized.length < 7 || normalized.length > 15 || typeof userName !== 'string' || !userName.trim())
      return res.status(400).json({ error: 'Enter your tracking number, receiver phone, and name.' });
    const shipment = await Shipment.findOne({ id: trackingId.trim().toUpperCase() });
    if (!shipment || normalizePhone(shipment.receiver?.tel) !== normalized)
      return res.status(403).json({ error: 'Tracking number or receiver phone does not match.' });
    unlockAttempts.delete(key);
    const phoneKey = chatPhoneKey(normalized);
    const sessionId = 'ship_' + chatPhoneKey(shipment.id + ':' + normalized);
    const assignedAdmin = shipment.ownerAdmin || process.env.ADMIN_USERNAME || 'admin';
    const chat = await Chat.findOneAndUpdate({ sessionId }, {
      $set: { assignedAdmin, userName: userName.trim().slice(0, 80), userEmail: typeof userEmail === 'string' ? userEmail.slice(0, 254) : '' },
      $setOnInsert: { sessionId, shipmentId: shipment.id, phoneKey, messages: [] }
    }, { new: true, upsert: true });
    const chatToken = jwt.sign({ purpose: 'shipment-chat', sessionId, shipmentId: shipment.id, phoneKey }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ chatToken, chat });
  } catch { res.status(500).json({ error: 'Unable to unlock chat' }); }
});
async function chatAccess(req, res, next) {
  if (req.headers.authorization) return authRequired(req, res, () => {
    req.chatFilter = adminChatFilter(req);
    next();
  });
  try {
    const claims = jwt.verify(req.headers['x-chat-token'], JWT_SECRET);
    const sessionId = req.params.sessionId || req.body.sessionId;
    if (claims.purpose !== 'shipment-chat' || claims.sessionId !== sessionId) throw new Error('Invalid access');
    const shipment = await Shipment.findOne({ id: claims.shipmentId });
    if (!shipment || chatPhoneKey(normalizePhone(shipment.receiver?.tel)) !== claims.phoneKey) throw new Error('Access changed');
    req.chatFilter = { shipmentId: claims.shipmentId, assignedAdmin: shipment.ownerAdmin || process.env.ADMIN_USERNAME || 'admin' };
    next();
  } catch { res.status(401).json({ error: 'Unlock shipment chat again to continue.' }); }
}
function validChatMessage(text, image) {
  return (!text || typeof text === 'string' && text.length <= 10000) &&
    (!image || typeof image === 'string' && image.length <= 7000000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) && !!(text || image);
}
app.post('/api/chat/message', chatAccess, async (req, res) => {
  if (req.admin) return res.status(403).json({ error: 'Use the admin reply route' });
  try {
    const { sessionId, text, image } = req.body;
    if (!validChatMessage(text, image)) return res.status(400).json({ error: 'Enter a message or a supported image (maximum 5 MB).' });
    const chat = await Chat.findOneAndUpdate({ sessionId, ...req.chatFilter }, {
      $push: { messages: { role: 'user', text: text || '', image: image || null, timestamp: new Date() } },
      $inc: { unread: 1 }, $set: { resolved: false, updatedAt: new Date() }
    }, { new: true });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch { res.status(500).json({ error: 'Unable to send message' }); }
});
app.get('/api/chat/session/:sessionId', chatAccess, async (req, res) => {
  try {
    const chat = await Chat.findOne({ sessionId: req.params.sessionId, ...req.chatFilter });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch { res.status(500).json({ error: 'Unable to load chat' }); }
});

// ADMIN: Get all chat sessions
app.get('/api/chat/sessions', authRequired, async (req, res) => {
  try {
    const chats = await Chat.find(adminChatFilter(req)).sort({ updatedAt: -1 }).lean();
    res.json(chats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: Reply to a chat
app.post('/api/chat/reply', authRequired, async (req, res) => {
  try {
    const { sessionId, text, image } = req.body;
    if (typeof sessionId !== 'string' || !validChatMessage(text, image)) return res.status(400).json({ error: 'Invalid message' });
    const chat = await Chat.findOneAndUpdate(
      { sessionId, ...adminChatFilter(req) },
      {
        $push: { messages: { role: 'admin', text: text||'', image: image||null, timestamp: new Date() } },
        $set:  { updatedAt: new Date() }
      },
      { new: true }
    );
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: Mark session as read
app.patch('/api/chat/session/:sessionId/read', authRequired, async (req, res) => {
  try {
    const chat = await Chat.findOneAndUpdate({ sessionId: req.params.sessionId, ...adminChatFilter(req) }, { $set: { unread: 0 } });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: Mark session as resolved
app.patch('/api/chat/session/:sessionId/resolve', authRequired, async (req, res) => {
  try {
    const chat = await Chat.findOneAndUpdate({ sessionId: req.params.sessionId, ...adminChatFilter(req) }, { $set: { resolved: true, unread: 0 } });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: Total unread count
app.get('/api/chat/unread', authRequired, async (req, res) => {
  try {
    const result = await Chat.aggregate([{ $match: adminChatFilter(req) }, { $group: { _id: null, total: { $sum: '$unread' } } }]);
    res.json({ unread: result[0]?.total || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});