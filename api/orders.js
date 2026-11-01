/**
 * Vercel Serverless Function - Order Management
 * Handles order creation, status queries, and payments
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// In-memory database (Vercel KV recommended for production)
let DB = {
  users: {},
  subscriptions: {},
  orders: {},
  transactions: [],
  refunds: {}
};

// Load persisted data if exists
try {
  const dbPath = path.join(__dirname, '..', '.data', 'payments.json');
  if (fs.existsSync(dbPath)) {
    DB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
} catch(e) {}

function saveDB() {
  try {
    const dir = path.join(__dirname, '..', '.data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'payments.json'), JSON.stringify(DB, null, 2));
  } catch(e) {}
}

// Payment gateway config
const config = {
  demoMode: process.env.PAY_MODE === 'demo' || !process.env.STRIPE_SECRET_KEY,
  currency: process.env.CURRENCY || 'CNY',
  exchangeRate: parseFloat(process.env.EXCHANGE_RATE) || 7.2,
  plans: {
    monthly: { id: 'monthly', name: 'Monthly Plan', price: 29, credits: 500, features: ['500 AI generations/month', 'Basic support', 'Template library'] },
    quarterly: { id: 'quarterly', name: 'Quarterly Plan', price: 75, credits: 1800, features: ['1800 AI generations/quarter', 'Priority support', 'Advanced templates', 'Analytics'] },
    yearly: { id: 'yearly', name: 'Yearly Plan', price: 99, credits: 7500, features: ['7500 AI generations/year', 'Dedicated support', 'All features', 'API access', 'Custom integration'] }
  },
  secretKey: process.env.PAYMENT_SECRET || crypto.randomBytes(32).toString('hex')
};

async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  try {
    switch (req.method) {
      case 'GET':
        if (req.url.startsWith('/api/plans')) return getPlans(res);
        if (req.url.match(/\/api\/status\/(.+)/)) return getUserStatus(req, res);
        if (req.url.match(/\/api\/history\/(.+)/)) return getBillingHistory(req, res);
        break;
      
      case 'POST':
        if (req.url === '/api/create-order') return createOrder(req, res);
        if (req.url === '/api/demo-pay') return handleDemoPay(req, res);
        if (req.url === '/api/callback') return handleCallback(req, res);
        if (req.url === '/api/cancel') return cancelSubscription(req, res);
        if (req.url === '/api/debit') return debitCredits(req, res);
        break;
    }
    
    return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

function getPlans(res) {
  const plans = Object.values(config.plans).map(p => ({
    ...p,
    priceCents: p.price * 100,
    usdPrice: Math.round((p.price / config.exchangeRate) * 100) / 100
  }));
  res.json({ ok: true, plans, demoMode: config.demoMode, currency: config.currency });
}

async function getUserStatus(req, res) {
  const userId = req.url.match(/\/api\/status\/(.+)/)?.[1];
  if (!userId) return res.status(400).json({ ok: false, error: 'USER_ID_REQUIRED' });
  
  const user = DB.users[userId];
  if (!user) return res.json({ ok: true, hasSubscription: false, credits: 0, message: 'NEW_USER' });
  
  const activeSub = Object.values(user.subscriptions).find(s => s.status === 'active' && s.endDate > Date.now());
  
  res.json({
    ok: true,
    hasSubscription: !!activeSub,
    currentPlan: activeSub?.planId || null,
    remainingCredits: user.credits || 0,
    subscriptionExpiry: activeSub?.endDate || null,
    billingHistory: (user.payments || []).slice(-10)
  });
}

function getBillingHistory(req, res) {
  const userId = req.url.match(/\/api\/history\/(.+)/)?.[1];
  if (!userId) return res.status(400).json({ ok: false, error: 'USER_ID_REQUIRED' });
  
  const user = DB.users[userId];
  const history = user?.payments || [];
  
  res.json({ ok: true, userId, history: history.slice(-50), totalSpent: history.reduce((s, p) => s + p.amount, 0) });
}

async function createOrder(req, res) {
  const { userId, planId, channel } = req.body;
  
  if (!userId || !planId) {
    return res.status(400).json({ ok: false, error: 'USER_ID_AND_PLAN_REQUIRED' });
  }
  
  const plan = config.plans[planId];
  if (!plan) return res.status(400).json({ ok: false, error: 'INVALID_PLAN' });
  
  const orderId = 'ORD-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  
  const order = {
    orderId,
    userId,
    planId,
    channel: channel || 'demo',
    amount: plan.price,
    currency: config.currency,
    status: 'CREATED',
    createdAt: Date.now(),
    expiresAt: Date.now() + 15 * 60 * 1000
  };
  
  DB.orders[orderId] = order;
  
  // Initialize user if needed
  if (!DB.users[userId]) {
    DB.users[userId] = { subscriptions: {}, credits: 10, payments: [] }; // 10 free credits
  }
  
  saveDB();
  
  // Build payment params based on channel
  let payParams = {};
  if (channel === 'demo' || config.demoMode) {
    payParams = {
      mode: 'demo',
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${orderId}`,
      success: true,
      message: 'Demo mode: Click "Simulate Payment" to complete'
    };
  } else if (channel === 'stripe') {
    // Stripe would integrate here with real API
    payParams = {
      mode: 'real',
      channel: 'stripe',
      checkoutUrl: `/payment/stripe/${orderId}`
    };
  } else {
    payParams = {
      mode: 'demo',
      channel: channel,
      success: true,
      message: `${channel} payment simulated`
    };
  }
  
  res.json({ ok: true, order, pay: payParams });
}

async function handleDemoPay(req, res) {
  const { orderId, userId } = req.body;
  
  const order = DB.orders[orderId];
  if (!order || order.userId !== userId) {
    return res.status(404).json({ ok: false, error: 'ORDER_NOT_FOUND' });
  }
  
  if (order.status === 'PAID') {
    return res.json({ ok: true, alreadyPaid: true });
  }
  
  // Mark as paid
  order.status = 'PAID';
  order.paidAt = Date.now();
  
  // Grant subscription
  await grantSubscription(userId, order.planId);
  
  // Record transaction
  DB.transactions.push({
    id: crypto.randomBytes(16).toString('hex'),
    orderId,
    userId,
    planId: order.planId,
    amount: order.amount,
    channel: order.channel,
    type: 'subscription',
    status: 'completed',
    createdAt: Date.now()
  });
  
  saveDB();
  
  res.json({
    ok: true,
    orderId,
    userId,
    planId: order.planId,
    amount: order.amount,
    message: 'Payment successful'
  });
}

async function grantSubscription(userId, planId) {
  const plan = config.plans[planId];
  if (!plan) return;
  
  if (!DB.users[userId]) {
    DB.users[userId] = { subscriptions: {}, credits: 0, payments: [] };
  }
  
  const user = DB.users[userId];
  const now = Date.now();
  let days = 30;
  if (planId === 'quarterly') days = 90;
  if (planId === 'yearly') days = 365;
  
  user.subscriptions[planId] = {
    planId,
    planName: plan.name,
    startDate: now,
    endDate: now + days * 24 * 60 * 60 * 1000,
    status: 'active',
    credits: plan.credits,
    paidAmount: plan.price
  };
  
  user.credits += plan.credits;
  user.payments.push({
    orderId: `PAY-${Date.now()}`,
    amount: plan.price,
    planId,
    date: now,
    status: 'completed'
  });
  
  saveDB();
}

async function handleCallback(req, res) {
  // This handles Stripe/webhook callbacks in production
  const { orderId, channel } = req.body;
  const order = DB.orders[orderId];
  
  if (!order) return res.status(404).json({ ok: false, error: 'ORDER_NOT_FOUND' });
  if (order.status === 'PAID') return res.json({ ok: true, alreadyPaid: true });
  
  order.status = 'PAID';
  order.paidAt = Date.now();
  order.channel = channel;
  
  await grantSubscription(order.userId, order.planId);
  
  DB.transactions.push({
    id: crypto.randomBytes(16).toString('hex'),
    orderId,
    userId: order.userId,
    planId: order.planId,
    amount: order.amount,
    channel,
    type: 'subscription',
    status: 'completed',
    createdAt: Date.now()
  });
  
  saveDB();
  
  res.json({ ok: true, orderId, userId: order.userId, planId: order.planId });
}

function cancelSubscription(req, res) {
  const { userId, planId } = req.body;
  const user = DB.users[userId];
  
  if (!user || !user.subscriptions[planId]) {
    return res.status(404).json({ ok: false, error: 'SUBSCRIPTION_NOT_FOUND' });
  }
  
  user.subscriptions[planId].status = 'cancelled';
  user.subscriptions[planId].cancelledAt = Date.now();
  saveDB();
  
  res.json({ ok: true, planId, cancelledAt: Date.now() });
}

function debitCredits(req, res) {
  const { userId, units, rate } = req.body;
  const user = DB.users[userId];
  
  if (!user) return res.status(404).json({ ok: false, error: 'USER_NOT_FOUND' });
  
  const amount = Math.ceil(units * (rate || 1));
  if ((user.credits || 0) < amount) {
    return res.json({ ok: false, reason: 'INSUFFICIENT_BALANCE', balance: user.credits, required: amount });
  }
  
  user.credits -= amount;
  saveDB();
  
  res.json({ ok: true, balance: user.credits, charged: amount });
}

module.exports = handler;
