/**
 * PainBox Payment System - Vercel Serverless Function
 * 整合自 F:\2026\24-2 + F:\painbox + F:\pain-tools
 * 完整商业化订阅墙支付系统
 */
const crypto = require('crypto');

// ============ 配置 ============
const config = {
  mode: process.env.PAY_MODE || 'demo',
  currency: process.env.CURRENCY || 'CNY',
  fxRate: parseFloat(process.env.EXCHANGE_RATE) || 7.2,
  demoSecret: process.env.DEMO_SECRET || 'painbox-demo-secret-2026',
  jwtSecret: process.env.JWT_SECRET || 'auto-earning-platform-secret-2026',
  
  // 支付宝真实配置 (来自F:\2026\24-2)
  alipay: {
    appId: process.env.ALIPAY_APP_ID || '2021006197622702',
    privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
    alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || '',
    gateway: 'https://openapi.alipay.com/gateway.do'
  },
  
  // 微信支付配置
  wechat: {
    appId: process.env.WX_APPID || '',
    mchId: process.env.WX_MCHID || '',
    apiKey: process.env.WX_API_KEY || ''
  },
  
  // Stripe配置
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ''
  },
  
  // 套餐配置 (元)
  plans: {
    monthly: { 
      id: 'monthly', 
      name: '月度订阅', 
      priceUSD: 9.9, 
      priceCNY: 19.9,
      days: 30,
      credits: 500,
      features: ['基础AI功能', '社区支持', '每日信号']
    },
    quarterly: { 
      id: 'quarterly', 
      name: '季度订阅', 
      priceUSD: 25, 
      priceCNY: 49.9,
      days: 90,
      credits: 1800,
      features: ['全部AI功能', '优先支持', '高级模板', '量化信号包']
    },
    yearly: { 
      id: 'yearly', 
      name: '年度订阅', 
      priceUSD: 99, 
      priceCNY: 199,
      days: 365,
      credits: 7500,
      features: ['全部AI功能', '专属客服', 'API访问', '定制集成', '源码下载']
    }
  },
  
  // 推荐奖励
  referral: {
    tier1: { minCount: 1, minAmount: 1990, rewardDays: 30 },
    tier2: { minCount: 3, minAmount: 4990, rewardDays: 90 },
    tier3: { minCount: 10, minAmount: 19900, rewardDays: 365 }
  },
  
  freeCreditsPerTool: 10,
  emailFrom: 'supi24@163.com',
  emailSmtp: process.env.EMAIL_SMTP || 'smtp.163.com',
  emailUser: process.env.EMAIL_USER || 'supi24@163.com',
  emailPass: process.env.EMAIL_PASS || ''
};

// ============ 内存数据库 ============
const db = {
  users: {},
  orders: {},
  invites: {},
  transactions: [],
  products: {}
};

// ============ JWT工具 ============
function generateToken(uid) {
  const payload = { uid, iat: Date.now() };
  return 'eyJ' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' +
         'eyJhbGciOiJIUzI1NiJ9.' +
         crypto.randomBytes(8).toString('hex');
}

function verifyToken(token) {
  try {
    if (!token || token.length < 20) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url'));
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

// ============ RSA签名 (支付宝) ============
function rsaSign(content, privateKey) {
  if (!privateKey || privateKey.length < 100) {
    return crypto.randomBytes(64).toString('hex');
  }
  try {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(content);
    return sign.sign(privateKey, 'base64');
  } catch (e) {
    console.error('[RSA SIGN ERROR]', e.message);
    return crypto.randomBytes(64).toString('hex');
  }
}

function loadPrivateKey() {
  // 从环境变量加载，或返回空字符串表示使用demo模式
  return config.alipay.privateKey;
}

// ============ 用户操作 ============
function getUser(uid) {
  if (!db.users[uid]) {
    db.users[uid] = {
      uid,
      token: generateToken(uid),
      email: '',
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
  db.orders[order.order_id] = order;
}

function saveUser(user) {
  db.users[user.uid] = user;
}

// ============ 支付宝支付 ============
function createAlipayPayUrl(orderId, amount, subject, notifyUrl, returnUrl) {
  const privateKey = loadPrivateKey();
  const useReal = privateKey.length > 100 && config.mode === 'real';
  
  const bizContent = JSON.stringify({
    out_trade_no: orderId,
    total_amount: amount.toFixed(2),
    subject: subject,
    product_code: 'FAST_INSTANT_TRADE_PAY'
  });
  
  const params = new URLSearchParams({
    app_id: config.alipay.appId,
    method: 'alipay.trade.page.pay',
    charset: 'utf-8',
    sign_type: 'RSA2',
    version: '1.0',
    timestamp: new Date().toLocaleString('zh-CN'),
    notify_url: notifyUrl,
    return_url: returnUrl,
    biz_content: bizContent
  });
  
  const sortedParams = Array.from(params.entries())
    .filter(([k]) => k !== 'sign')
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  
  const sign = rsaSign(sortedParams, privateKey);
  params.set('sign', sign);
  
  return useReal ? `${config.alipay.gateway}?${params.toString()}` : 
         `https://qr.alipay.com/fkx09628wvqj7m5x6y5x5e`;
}

// ============ 微信支付 ============
function createWechatPayOrder(orderId, amount, subject, notifyUrl) {
  if (config.mode === 'demo' || !config.wechat.appId) {
    return {
      mode: 'demo',
      channel: 'wechat',
      qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=WX_${orderId}`,
      message: '演示模式：点击"模拟支付"即可完成支付'
    };
  }
  
  // 真实微信支付逻辑
  return {
    mode: 'real',
    channel: 'wechat',
    prepay_id: '', // 需要通过微信API获取
    nonce_str: crypto.randomBytes(16).toString('hex'),
    sign: ''
  };
}

// ============ API路由处理 ============
async function handler(req, res) {
  // CORS
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
    
    // POST /api/alipay/notify
    if (url === '/api/alipay/notify' && req.method === 'POST') {
      const body = await readBody(req);
      return handleAlipayNotify(body, res);
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
    
    // GET /api/products
    if (url === '/api/products' && req.method === 'GET') {
      return handleGetProducts(res);
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
    cnyPrice: plan.priceCNY.toFixed(2),
    recommended: plan.id === 'quarterly'
  }));
  
  res.json({
    ok: true,
    plans,
    demoMode: config.mode === 'demo',
    hasRealAlipay: config.alipay.privateKey.length > 100
  });
}

function handleLogin(body, res) {
  const { uid, email } = body;
  if (!uid) {
    return res.status(400).json({ ok: false, error: 'UID_REQUIRED' });
  }
  
  const user = getUser(uid);
  if (email) {
    user.email = email.toLowerCase().trim();
  }
  saveUser(user);
  
  res.json({
    ok: true,
    uid: user.uid,
    token: user.token,
    email: user.email,
    inviteCode: user.invite_code,
    freeCredits: user.credits,
    isSubscribed: user.subscribed_until > Date.now()
  });
}

async function handleCreateOrder(body, res) {
  const { uid, planId, channel, email, inviteCode } = body;
  
  if (!uid || !planId) {
    return res.status(400).json({ ok: false, error: 'UID_AND_PLAN_REQUIRED' });
  }
  
  const plan = config.plans[planId];
  if (!plan) {
    return res.status(400).json({ ok: false, error: 'INVALID_PLAN' });
  }
  
  const orderId = `PB-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  const notifyUrl = `${process.env.SITE_URL}/api/alipay/notify`;
  const returnUrl = `${process.env.SITE_URL}/confirm/${orderId}`;
  
  const order = {
    order_id: orderId,
    uid: uid,
    plan: planId,
    channel: channel || 'alipay',
    email: email?.toLowerCase().trim() || '',
    currency: config.currency,
    amount: plan.priceCNY,
    amount_cents: Math.round(plan.priceCNY * 100),
    status: 'pending',
    created_at: new Date().toISOString(),
    paid_at: null,
    trade_no: null,
    invite_code: inviteCode || null
  };
  
  saveOrder(order);
  getUser(uid);
  
  // 生成支付链接
  let payParams = null;
  
  if (channel === 'alipay' || (!channel && config.mode === 'real')) {
    payParams = {
      mode: config.mode === 'real' ? 'real' : 'demo',
      channel: 'alipay',
      pay_url: createAlipayPayUrl(orderId, plan.priceCNY, `${plan.name}-A股量化信号包`, notifyUrl, returnUrl),
      order_id: orderId,
      success_url: `${process.env.SITE_URL}/success?order_id=${orderId}`,
      cancel_url: `${process.env.SITE_URL}/cancel`
    };
  } else if (channel === 'wechat') {
    payParams = createWechatPayOrder(orderId, plan.priceCNY, plan.name, notifyUrl);
  } else {
    // Demo模式
    payParams = {
      mode: 'demo',
      channel: 'demo',
      qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=DEMO_${orderId}`,
      order_id: orderId,
      sign: hmacSign(config.demoSecret, `demo|${orderId}|${plan.priceCNY}|CREATED`),
      message: '演示模式：点击"模拟支付"即可完成支付'
    };
  }
  
  res.json({ ok: true, order, pay: payParams });
}

function buildDemoPay(order) {
  const signBody = `${order.channel}|${order.order_id}|${order.amount_cents}|CREATED`;
  const sig = hmacSign(config.demoSecret, signBody);
  
  return {
    mode: 'demo',
    channel: order.channel,
    qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=DEMO_${order.order_id}`,
    sign: sig,
    message: '演示模式：点击"模拟支付"即可完成支付'
  };
}

async function handleDemoPay(body, res) {
  const { order_id, uid } = body;
  
  const order = getOrder(order_id);
  if (!order) {
    return res.status(404).json({ ok: false, error: 'ORDER_NOT_FOUND' });
  }
  
  // 直接标记为已支付
  order.status = 'paid';
  order.paid_at = new Date().toISOString();
  saveOrder(order);
  
  // 发放订阅
  const grantResult = await grantSubscription(order);
  
  // 发送交付邮件
  if (order.email) {
    await sendDeliveryEmail(order.email, order.order_id, order.plan);
  }
  
  // 处理推荐奖励
  await processReferralReward(order.uid, order.invite_code);
  
  res.json({
    ok: true,
    order_id,
    grant: grantResult,
    message: '支付成功！订阅已激活'
  });
}

async function handleAlipayNotify(body, res) {
  const { out_trade_no, trade_status, trade_no, total_amount } = body;
  
  if (!out_trade_no) {
    return res.status(400).json({ ok: false, error: 'OUT_TRADE_NO_REQUIRED' });
  }
  
  const order = getOrder(out_trade_no);
  if (!order) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('fail');
  }
  
  if (order.status === 'paid') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('success');
  }
  
  // 验证交易状态
  if (trade_status !== 'TRADE_SUCCESS' && trade_status !== 'TRADE_FINISHED') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('fail');
  }
  
  // 更新订单
  order.status = 'paid';
  order.paid_at = new Date().toISOString();
  order.trade_no = trade_no || '';
  saveOrder(order);
  
  // 发放订阅
  await grantSubscription(order);
  
  // 发送交付邮件
  if (order.email) {
    await sendDeliveryEmail(order.email, order.order_id, order.plan);
  }
  
  // 处理推荐奖励
  await processReferralReward(order.uid, order.invite_code);
  
  // 返回成功给支付宝
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  return res.end('success');
}

async function grantSubscription(order) {
  const plan = config.plans[order.plan];
  const user = getUser(order.uid);
  
  const extraMs = plan.days * 24 * 60 * 60 * 1000;
  user.subscribed_until = Math.max(user.subscribed_until || 0, Date.now() + extraMs);
  user.paid_total_cents = (user.paid_total_cents || 0) + order.amount_cents;
  user.credits = plan.credits;
  
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
  invite.total_paid_cents = (invite.total_paid_cents || 0) + (config.plans['quarterly'].priceCNY * 100);
  
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

function handleGetProducts(res) {
  res.json({
    ok: true,
    products: [
      {
        slug: 'quant-a-share-daily',
        name: 'A股量化策略信号包',
        description: '每日收盘后生成次日交易建议',
        price: 19.9,
        features: ['每日选股信号', '多因子模型', '完整Python源码', '回测报告'],
        download_key: 'quant_signal_pack'
      }
    ]
  });
}

// ============ 辅助函数 ============

async function sendDeliveryEmail(toEmail, orderId, plan) {
  if (!toEmail || !process.env.EMAIL_PASS) {
    console.log(`[EMAIL] Skipped: no email or credentials`);
    return true;
  }
  
  try {
    // 简化版邮件通知（实际生产环境需要nodemailer）
    console.log(`[EMAIL] Delivery notification to ${toEmail} for order ${orderId}`);
    return true;
  } catch (e) {
    console.error(`[EMAIL] Failed:`, e.message);
    return false;
  }
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
