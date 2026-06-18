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

// ── EMAIL FUNCTION ──
async function sendTrackingEmail(shipment, trackingUrl) {
  const recipientEmail = shipment.receiver?.email;
  if (!recipientEmail) return;

  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';

  try {
    await resend.emails.send({
      from: `QUIN-TRACK Logistics <${fromEmail}>`,
      to: recipientEmail,
      subject: `Your Shipment ${shipment.id} Has Been Created — QUIN-TRACK`,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:Inter,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:#111827;padding:28px 32px;">
      <div style="font-size:1.4rem;font-weight:900;color:#fff;letter-spacing:-0.03em;">QUIN<span style="color:#3b82f6;">-TRACK</span></div>
      <div style="height:2px;background:#3b82f6;width:80px;margin-top:4px;border-radius:1px;"></div>
    </div>
    <div style="padding:32px;">
      <h2 style="font-size:1.2rem;font-weight:700;color:#111827;margin:0 0 8px;">Your shipment is on its way!</h2>
      <p style="color:#6b7280;font-size:0.9rem;margin:0 0 24px;">Hi ${shipment.receiver?.name || 'there'}, your package has been registered and is being tracked.</p>
      <div style="background:#f8faff;border:1.5px solid #e0e7ff;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
        <p style="color:#6b7280;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px;">Your Tracking Number</p>
        <p style="color:#111827;font-family:monospace;font-weight:900;font-size:1.6rem;letter-spacing:0.05em;margin:0;">${shipment.id}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;width:40%;">Status</td><td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.status}</td></tr>
        <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;">Contents</td><td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.package?.content || '—'}</td></tr>
        <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;">From</td><td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.sender?.name || '—'}</td></tr>
        <tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;">Ship Date</td><td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.package?.shipDate || '—'}</td></tr>
        <tr><td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;">Expected</td><td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.package?.expDate || '—'}</td></tr>
      </table>
      <a href="${trackingUrl}" style="display:block;background:#111827;color:#fff;text-align:center;padding:14px;border-radius:12px;font-weight:700;font-size:0.9rem;text-decoration:none;margin-bottom:20px;">Track Your Shipment →</a>
      <p style="color:#9ca3af;font-size:0.78rem;text-align:center;margin:0;">Or copy: <a href="${trackingUrl}" style="color:#2563eb;">${trackingUrl}</a></p>
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;">
      <p style="color:#9ca3af;font-size:0.75rem;margin:0;">© 2026 QUIN-TRACK Logistics · Reliable. Clear. Fast.</p>
    </div>
  </div>
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
      html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:Inter,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <div style="background:#111827;padding:28px 32px;">
      <div style="font-size:1.4rem;font-weight:900;color:#fff;">QUIN<span style="color:#3b82f6;">-TRACK</span></div>
      <div style="height:2px;background:#3b82f6;width:80px;margin-top:4px;border-radius:1px;"></div>
    </div>
    <div style="padding:32px;">
      <h2 style="font-size:1.2rem;font-weight:700;color:#111827;margin:0 0 8px;">Shipment Status Update</h2>
      <p style="color:#6b7280;font-size:0.9rem;margin:0 0 24px;">Hi ${shipment.receiver?.name || 'there'}, your shipment status has been updated.</p>
      <div style="background:#f8faff;border:1.5px solid #e0e7ff;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
        <p style="color:#6b7280;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px;">${shipment.id}</p>
        <p style="color:${statusColor};font-weight:900;font-size:1.4rem;margin:0;">${shipment.status}</p>
      </div>
      <a href="${trackingUrl}" style="display:block;background:#111827;color:#fff;text-align:center;padding:14px;border-radius:12px;font-weight:700;font-size:0.9rem;text-decoration:none;">Track Your Shipment →</a>
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;">
      <p style="color:#9ca3af;font-size:0.75rem;margin:0;">© 2026 QUIN-TRACK Logistics</p>
    </div>
  </div>
</body>
</html>`
    });
    console.log(`✅ Status update email sent to ${recipientEmail}`);
  } catch (err) {
    console.error('❌ Status email error:', err?.message);
  }
}

// ══════════════
//  ROUTES
// ══════════════
app.get('/', (req, res) => res.json({ status: 'QUIN-TRACK API running 🚚', version: '1.0.0' }));

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

app.get('/api/shipments/:id', async (req, res) => {
  try {
    const shipment = await Shipment.findOne({ id: req.params.id.toUpperCase() }).lean();
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
    res.json(shipment);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

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

app.patch('/api/shipments/:id', authRequired, async (req, res) => {
  try {
    const oldShipment = await Shipment.findOne({ id: req.params.id.toUpperCase() });
    const shipment = await Shipment.findOneAndUpdate(
      { id: req.params.id.toUpperCase() },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
    // Send status update email if status changed
    if (oldShipment && req.body.status && req.body.status !== oldShipment.status) {
      const frontendUrl = process.env.FRONTEND_URL || 'https://quintrack-frontend.vercel.app';
      const trackingUrl = `${frontendUrl}/tracking-details.html?t=${shipment.id}`;
      sendStatusUpdateEmail(shipment, trackingUrl);
    }
    res.json(shipment);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/shipments/:id', authRequired, async (req, res) => {
  try {
    const result = await Shipment.deleteOne({ id: req.params.id.toUpperCase() });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

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

const app = express();

// ── MIDDLEWARE ──
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '10mb' }));

// ── SENDGRID ──
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  console.log('✅ SendGrid configured');
}

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
  sender: { name: String, address: String, city: String, zip: String, tel: String, email: String },
  receiver: { name: String, address: String, city: String, zip: String, tel: String, email: String },
  package: { content: String, qty: String, weight: String, from: String, orderType: String, shipDate: String, expDate: String },
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

// ── EMAIL FUNCTION ──
async function sendTrackingEmail(shipment, trackingUrl) {
  if (!process.env.SENDGRID_API_KEY || !process.env.FROM_EMAIL) return;

  const recipientEmail = shipment.receiver?.email;
  if (!recipientEmail) return;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:Inter,Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:#111827;padding:28px 32px;">
      <div style="font-size:1.4rem;font-weight:900;color:#fff;letter-spacing:-0.03em;">QUIN<span style="color:#3b82f6;">-TRACK</span></div>
      <div style="height:2px;background:#3b82f6;width:80px;margin-top:4px;border-radius:1px;"></div>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <h2 style="font-size:1.2rem;font-weight:700;color:#111827;margin:0 0 8px;">Your shipment is on its way!</h2>
      <p style="color:#6b7280;font-size:0.9rem;margin:0 0 24px;">Hi ${shipment.receiver?.name || 'there'}, your package has been registered and is being tracked.</p>

      <!-- Tracking ID box -->
      <div style="background:#f8faff;border:1.5px solid #e0e7ff;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
        <p style="color:#6b7280;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 6px;">Your Tracking Number</p>
        <p style="color:#111827;font-family:monospace;font-weight:900;font-size:1.6rem;letter-spacing:0.05em;margin:0;">${shipment.id}</p>
      </div>

      <!-- Details -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;width:40%;">Status</td>
          <td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.status}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Contents</td>
          <td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.package?.content || '—'}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">From</td>
          <td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.sender?.name || '—'}, ${shipment.sender?.city || ''}</td>
        </tr>
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Ship Date</td>
          <td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.package?.shipDate || '—'}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Expected</td>
          <td style="padding:10px 0;color:#111827;font-size:0.875rem;font-weight:600;">${shipment.package?.expDate || '—'}</td>
        </tr>
      </table>

      <!-- CTA Button -->
      <a href="${trackingUrl}" style="display:block;background:#111827;color:#fff;text-align:center;padding:14px;border-radius:12px;font-weight:700;font-size:0.9rem;text-decoration:none;margin-bottom:20px;">
        Track Your Shipment →
      </a>

      <p style="color:#9ca3af;font-size:0.78rem;text-align:center;margin:0;">
        Or copy this link: <a href="${trackingUrl}" style="color:#2563eb;">${trackingUrl}</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;text-align:center;">
      <p style="color:#9ca3af;font-size:0.75rem;margin:0;">© 2026 QUIN-TRACK Logistics · Reliable. Clear. Fast.</p>
    </div>
  </div>
</body>
</html>`;

  try {
    await sgMail.send({
      to: recipientEmail,
      from: { email: process.env.FROM_EMAIL, name: 'QUIN-TRACK Logistics' },
      subject: `Your Shipment ${shipment.id} Has Been Created — QUIN-TRACK`,
      html
    });
    console.log(`✅ Email sent to ${recipientEmail}`);
  } catch (err) {
    console.error('❌ Email error:', err?.response?.body || err.message);
  }
}

// ══════════════
//  ROUTES
// ══════════════

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

// CHANGE PASSWORD
app.post('/api/auth/change-password', authRequired, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Min 6 characters' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await Admin.updateOne({ username: req.admin.username }, { password: hashed });
    res.json({ message: 'Password updated' });
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

    // Send email notification to receiver
    const frontendUrl = process.env.FRONTEND_URL || 'https://your-site.netlify.app';
    const trackingUrl = `${frontendUrl}/tracking-details.html?t=${shipment.id}`;
    sendTrackingEmail(shipment, trackingUrl); // fire and forget

    res.status(201).json(shipment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PROTECTED: UPDATE shipment
app.patch('/api/shipments/:id', authRequired, async (req, res) => {
  try {
    const shipment = await Shipment.findOneAndUpdate(
      { id: req.params.id.toUpperCase() },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
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