/**
 * Auto-Earning Platform - Vercel Deployment Package
 * Complete Payment System with PainBox Integration
 */

const crypto = require('crypto');

// ============ 配置 ============
const config = {
  mode: process.env.PAY_MODE || 'demo',
  currency: process.env.CURRENCY || 'CNY',
  fxRate: parseFloat(process.env.EXCHANGE_RATE) || 7.2,
  demoSecret: process.env.DEMO_SECRET || 'painbox-demo-secret-2026',
  jwtSecret: process.env.JWT_SECRET || 'auto-earning-platform-secret-2026',
  
  // 套餐配置
  plans: {
    monthly: { 
      id: 'monthly', 
      name: '月度订阅', 
      priceUSD: 9.9, 
      priceCNY: 990,
      days: 30,
      features: ['基础功能', '社区支持', '500次AI生成']
    },
    quarterly: { 
      id: 'quarterly', 
      name: '季度订阅', 
      priceUSD: 25, 
      priceCNY: 2500,
      days: 90,
      features: ['全部功能', '优先支持', '数据分析', '1800次AI生成']
    },
    yearly: { 
      id: 'yearly', 
      name: '年度订阅', 
      priceUSD: 99, 
      priceCNY: 9900,
      days: 365,
      features: ['全部功能', '专属客服', 'API访问', '定制集成', '7500次AI生成']
    }
  },
  
  // 推荐奖励
  referral: {
    tier1: { minCount: 1, minAmount: 990, rewardDays: 30 },
    tier2: { minCount: 3, minAmount: 2500 * 3, rewardDays: 90 },
    tier3: { minCount: 10, minAmount: 9900 * 7.2 * 10, rewardDays: 365 }
  },
  
  freeCreditsPerTool: 10
};

// ============ JWT工具 ============
function generateToken(uid) {
  return jwt.sign({ uid, iat: Date.now() }, config.jwtSecret, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (e) {
    return null;
  }
}

// ============ HMAC签名 ============
function hmacSign(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function generateId(prefix = '') {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ============ 内存数据库 ============
const db = {
  users: {},
  orders: {},
  invites: {},
  transactions: []
};

function getUser(uid) {
  if (!db.users[uid]) {
    db.users[uid] = {
      uid,
      token: generateToken(uid),
      subscribed_until: 0,
      paid_total_cents: 0,
      credits: config.freeCreditsPerTool,
      rewards: {},
      invite_code: `INV-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      created_at: Date.now()
    };
  }
  return db.users[uid];
}

function getOrder(outTradeNo) {
  return db.orders?.[outTradeNo] || null;
}

function saveOrder(order) {
  if (!db.orders) db.orders = {};
  db.orders[order.out_trade_no] = order;
}

// ============ API路由 ============
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  
  try {
    const url = req.url.split('?')[0];
    
    // GET /api/plans
    if (url === '/api/plans' && req.method === 'GET') {
      return handleGetPlans(res);
    }
    
    // POST /api/auth/login
    if (url === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      return handleLogin(body, res);
    }
    
    // POST /api/create-order
    if (url === '/api/create-order' && req.method === 'POST') {
      const body = await readBody(req);
      return handleCreateOrder(body, res);
    }
    
    // POST /api/demo-pay
    if (url === '/api/demo-pay' && req.method === 'POST') {
      const body = await readBody(req);
      return handleDemoPay(body, res);
    }
    
    // POST /api/notify
    if (url === '/api/notify' && req.method === 'POST') {
      const body = await readBody(req);
      return handleNotify(body, res);
    }
    
    // GET /api/status/:userId
    const statusMatch = url.match(/^\/api\/status\/(.+)$/);
    if (statusMatch && req.method === 'GET') {
      return handleGetStatus(statusMatch[1], res);
    }
    
    // GET /api/referral/:userId
    const referralMatch = url.match(/^\/api\/referral\/(.+)$/);
    if (referralMatch && req.method === 'GET') {
      return handleGetReferral(referralMatch[1], res);
    }
    
    // GET /api/paywall/:userId
    const paywallMatch = url.match(/^\/api\/paywall\/(.+)$/);
    if (paywallMatch && req.method === 'GET') {
      return handleGetPaywall(paywallMatch[1], res);
    }
    
    return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    
  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

// ============ 处理器函数 ============

function handleGetPlans(res) {
  const plans = Object.values(config.plans).map(plan => ({
    ...plan,
    usdPrice: plan.priceUSD,
    cnyPrice: (plan.priceCNY / 100).toFixed(2),
    recommended: plan.id === 'quarterly'
  }));
  
  res.json({ ok: true, plans, demoMode: config.mode === 'demo' });
}

function handleLogin(body, res) {
  const { uid } = body;
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'UID_REQUIRED' });
  }
  
  const user = getUser(uid);
  res.json({
    ok: true,
    uid: user.uid,
    token: user.token,
    inviteCode: user.invite_code,
    freeCredits: user.credits,
    isSubscribed: user.subscribed_until > Date.now()
  });
}

async function handleCreateOrder(body, res) {
  const { uid, planId, channel, inviteCode } = body;
  
  if (!uid || !planId) {
    return res.status(400).json({ ok: false, error: 'UID_AND_PLAN_REQUIRED' });
  }
  
  const plan = config.plans[planId];
  if (!plan) {
    return res.status(400).json({ ok: false, error: 'INVALID_PLAN' });
  }
  
  const outTradeNo = generateId('PB');
  const order = {
    out_trade_no: outTradeNo,
    uid: uid,
    plan: planId,
    channel: channel || 'demo',
    currency: config.currency,
    amount_cents: plan.priceCNY,
    status: 'CREATED',
    created_at: Date.now(),
    expires_at: Date.now() + 15 * 60 * 1000,
    invite_code: inviteCode || null
  };
  
  saveOrder(order);
  getUser(uid);
  
  let payParams = buildDemoPay(order);
  
  res.json({ ok: true, order, pay: payParams });
}

function buildDemoPay(order) {
  const signBody = `${order.channel}|${order.out_trade_no}|${order.amount_cents}|CREATED`;
  const sig = hmacSign(config.demoSecret, signBody);
  
  return {
    mode: 'demo',
    channel: order.channel,
    qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=DEMO_${order.out_trade_no}`,
    sign: sig,
    success_url: `${process.env.SITE_URL}/success?order_id=${order.out_trade_no}&uid=${order.uid}`,
    cancel_url: `${process.env.SITE_URL}/cancel`,
    message: '演示模式：点击"模拟支付"即可完成支付'
  };
}

async function handleDemoPay(body, res) {
  const { out_trade_no, uid } = body;
  
  const order = getOrder(outTradeNo);
  if (!order) {
    return res.status(404).json({ ok: false, error: 'ORDER_NOT_FOUND' });
  }
  
  const notifyBody = {
    out_trade_no,
    uid: order.uid || uid,
    plan: order.plan,
    channel: order.channel,
    status: 'PAID',
    trade_status: 'TRADE_SUCCESS',
    amount_cents: order.amount_cents,
    sign: generateDemoSign(out_trade_no, order.amount_cents)
  };
  
  return handleNotify(notifyBody, res);
}

function generateDemoSign(outTradeNo, amount) {
  const body = `alipay|${outTradeNo}|${amount}|PAID`;
  return hmacSign(config.demoSecret, body);
}

async function handleNotify(data, res) {
  const outTradeNo = data.out_trade_no;
  if (!outTradeNo) {
    return res.status(400).json({ ok: false, error: 'OUT_TRADE_NO_REQUIRED' });
  }
  
  const order = getOrder(outTradeNo);
  if (!order) {
    return res.status(404).json({ ok: false, error: 'ORDER_NOT_FOUND' });
  }
  
  if (order.status === 'PAID') {
    return res.json({ ok: true, alreadyPaid: true });
  }
  
  if (config.mode === 'demo') {
    const expectedSig = generateDemoSign(outTradeNo, data.amount_cents);
    if (!hmacSign(config.demoSecret, `${data.channel}|${outTradeNo}|${data.amount_cents}|PAID`) && 
        data.sign !== expectedSig) {
      return res.status(400).json({ ok: false, error: 'SIGN_INVALID' });
    }
  }
  
  order.status = 'PAID';
  order.paid_at = Date.now();
  saveOrder(order);
  
  const grantResult = await grantSubscription(order);
  await processReferralReward(order.uid, order.invite_code);
  
  db.transactions.push({
    id: generateId('TXN'),
    orderId: outTradeNo,
    userId: order.uid,
    planId: order.plan,
    amount: order.amount_cents,
    channel: order.channel,
    status: 'completed',
    created_at: Date.now()
  });
  
  res.json({ ok: true, orderId: outTradeNo, grant: grantResult });
}

async function grantSubscription(order) {
  const plan = config.plans[order.plan];
  const user = getUser(order.uid);
  
  const extraMs = plan.days * 24 * 60 * 60 * 1000;
  user.subscribed_until = Math.max(user.subscribed_until || 0, Date.now() + extraMs);
  user.paid_total_cents = (user.paid_total_cents || 0) + order.amount_cents;
  user.credits = config.freeCreditsPerTool;
  
  saveUser(user);
  
  return {
    ok: true,
    plan: order.plan,
    daysAdded: plan.days,
    newExpiry: user.subscribed_until,
    message: '订阅激活成功！所有功能已解锁。'
  };
}

async function processReferralReward(uid, inviteCode) {
  if (!inviteCode) return;
  
  // 查找邀请者
  let inviterUid = null;
  for (const [uId, userInfo] of Object.entries(db.users)) {
    if (userInfo.invite_code === inviteCode) {
      inviterUid = uId;
      break;
    }
  }
  
  if (!inviterUid) return;
  
  const inviter = getUser(inviterUid);
  if (!inviter.rewards) inviter.rewards = {};
  
  // 更新邀请统计
  const inviteKey = `${inviterUid}_${uid}`;
  if (!db.invites[inviteKey]) {
    db.invites[inviteKey] = {
      inviter_uid: inviterUid,
      invited_uid: uid,
      invite_code: inviteCode,
      paid_count: 0,
      total_paid_cents: 0,
      created_at: Date.now()
    };
  }
  
  const invite = db.invites[inviteKey];
  invite.paid_count = (invite.paid_count || 0) + 1;
  invite.total_paid_cents = (invite.total_paid_cents || 0) + 990;
  
  // 应用奖励
  await applyTierRewards(inviterUid, invite);
}

async function applyTierRewards(uid, invite) {
  const user = getUser(uid);
  if (!user.rewards) user.rewards = {};
  
  const refConfig = config.referral;
  let changed = false;
  const now = Date.now();
  
  // Tier 1
  if (!user.rewards['r1m'] && invite.paid_count >= refConfig.tier1.minCount) {
    user.subscribed_until = (user.subscribed_until || 0) + refConfig.tier1.rewardDays * 86400000;
    user.rewards['r1m'] = now;
    changed = true;
  }
  
  // Tier 2
  if (!user.rewards['r3m'] && invite.paid_count >= refConfig.tier2.minCount) {
    user.subscribed_until = (user.subscribed_until || 0) + refConfig.tier2.rewardDays * 86400000;
    user.rewards['r3m'] = now;
    changed = true;
  }
  
  // Tier 3
  if (!user.rewards['r1y'] && invite.paid_count >= refConfig.tier3.minCount) {
    user.subscribed_until = (user.subscribed_until || 0) + refConfig.tier3.rewardDays * 86400000;
    user.rewards['r1y'] = now;
    changed = true;
  }
  
  if (changed) saveUser(user);
  return user;
}

function handleGetStatus(uid, res) {
  const user = getUser(uid);
  const now = Date.now();
  const isSubscribed = user.subscribed_until > now;
  
  res.json({
    ok: true,
    uid,
    isSubscribed,
    subscribedUntil: user.subscribed_until,
    timeRemaining: isSubscribed ? Math.ceil((user.subscribed_until - now) / 86400000) : 0,
    paidTotalCents: user.paid_total_cents || 0,
    rewards: user.rewards || {},
    inviteCode: user.invite_code,
    freeCredits: user.credits || config.freeCreditsPerTool
  });
}

function handleGetReferral(uid, res) {
  const user = getUser(uid);
  
  res.json({
    ok: true,
    uid,
    inviteLink: `${process.env.SITE_URL}/invite/${user.invite_code}`,
    inviteCode: user.invite_code,
    stats: Object.values(db.invites).filter(i => i.inviter_uid === uid).map(i => ({
      invited_uid: i.invited_uid,
      paid_count: i.paid_count,
      total_paid_cents: i.total_paid_cents
    }))
  });
}

function handleGetPaywall(uid, res) {
  const user = getUser(uid);
  const isLocked = !(user.subscribed_until > Date.now());
  
  res.json({
    lockState: isLocked ? 'locked' : 'unlocked',
    currentPlan: isLocked ? 'Free' : 'Pro',
    remainingTime: isLocked ? 0 : user.subscribed_until - Date.now(),
    freeCredits: user.credits || config.freeCreditsPerTool,
    upgradeUrl: '/pricing',
    paymentChannels: [
      { id: 'demo', name: 'Demo模式', icon: '🧪', recommended: true },
      { id: 'alipay', name: '支付宝', icon: '🔵' },
      { id: 'wechat', name: '微信支付', icon: '🟢' },
      { id: 'stripe', name: '信用卡', icon: '💳' }
    ]
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

module.exports = handler;
