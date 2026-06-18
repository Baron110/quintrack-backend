const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();

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
seedAdmin();

// ── AUTH ──
function authRequired(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET || 'qt-secret');
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
  try {
    await resend.emails.send({
      from: `QUIN-TRACK Logistics <${fromEmail}>`,
      to: recipientEmail,
      subject: `Your Shipment ${shipment.id} Has Been Created — QUIN-TRACK`,
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
            <h1 style="font-size:22px;font-weight:800;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">Your shipment is on its way! 🚚</h1>
            <p style="color:#6b7280;font-size:15px;margin:0;line-height:1.6;">Hi <strong style="color:#111827;">${shipment.receiver?.name || 'there'}</strong>, your package has been registered and is now being tracked in real-time.</p>
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
    console.log(`✅ Email sent to ${recipientEmail}`);
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
    await resend.emails.send({
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
    console.log(`✅ Status update email sent to ${recipientEmail}`);
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
    const token = jwt.sign({ username }, process.env.JWT_SECRET || 'qt-secret', { expiresIn: '8h' });
    res.json({ token, username });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PUBLIC: GET single shipment
app.get('/api/shipments/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findOne({ id: req.params.id.toUpperCase() }).lean();
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
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
    const shipments = await Shipment.find(filter).sort({ createdAt: -1 }).lean();
    res.json(shipments);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PROTECTED: CREATE shipment + send email
app.post('/api/shipments', authRequired, async (req, res) => {
  try {
    const data = req.body;
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
    const oldShipment = await Shipment.findOne({ id: req.params.id.toUpperCase() });
    const shipment = await Shipment.findOneAndUpdate(
      { id: req.params.id.toUpperCase() },
      { $set: req.body },
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
    const result = await Shipment.deleteOne({ id: req.params.id.toUpperCase() });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PROTECTED: STATS
app.get('/api/stats', authRequired, async (req, res) => {
  try {
    const [total, transit, delivered, pending] = await Promise.all([
      Shipment.countDocuments(),
      Shipment.countDocuments({ status: { $in: ['In Transit','Out for Delivery'] } }),
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