/**
 * PainBox Payment System - Vercel Serverless Function
 * 完整集成丙大山AI Agent支付架构 + 真实渠道对接
 */
const crypto = require('crypto');

// ============ 配置 ============
const config = {
  mode: process.env.PAY_MODE || 'demo',
  currency: process.env.CURRENCY || 'CNY',
  fxRate: parseFloat(process.env.EXCHANGE_RATE) || 7.2,
  demoSecret: process.env.DEMO_SECRET || 'painbox-demo-secret-2026',
  
  // 套餐配置 (分)
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
  
  // 推荐奖励配置
  referral: {
    tier1: { minCount: 1, minAmount: 990, rewardDays: 30 },
    tier2: { minCount: 3, minAmount: 2500 * 3, rewardDays: 90 },
    tier3: { minCount: 10, minAmount: 9900 * 7.2 * 10, rewardDays: 365 }
  },
  
  freeCreditsPerTool: 10,
  
  // 数据库路径 (Vercel内存存储)
  store: {}
};

// ============ 工具函数 ============
function generateId(prefix = '') {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function hmacSign(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function verifySignature(secret, data, signature) {
  const expected = hmacSign(secret, data);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ============ 数据库操作 ============
function getUser(uid) {
  if (!config.store.users[uid]) {
    config.store.users[uid] = {
      uid: uid,
      subscribed_until: 0,
      paid_total_cents: 0,
      credits: config.freeCreditsPerTool,
      rewards: {},
      invites_sent: [],
      invite_code: 'INV-' + Math.random().toString(36).substr(2, 6).toUpperCase(),
      created_at: Date.now()
    };
  }
  return config.store.users[uid];
}

function getOrder(outTradeNo) {
  return config.store.orders?.[outTradeNo] || null;
}

function saveOrder(order) {
  if (!config.store.orders) config.store.orders = {};
  config.store.orders[order.out_trade_no] = order;
}

function saveUser(user) {
  config.store.users[user.uid] = user;
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
    // 路由分发
    const url = req.url.split('?')[0];
    
    // GET /api/plans
    if (url === '/api/plans' && req.method === 'GET') {
      return handleGetPlans(res);
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
    features: plan.features
  }));
  
  res.json({
    ok: true,
    plans,
    demoMode: config.mode === 'demo',
    currency: config.currency
  });
}

async function handleCreateOrder(body, res) {
  const { uid, planId, channel } = body;
  
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
    expires_at: Date.now() + 15 * 60 * 1000
  };
  
  saveOrder(order);
  getUser(uid); // 确保用户存在
  
  // 构建支付参数
  let payParams = null;
  
  if (channel === 'demo' || config.mode === 'demo') {
    payParams = buildDemoPay(order);
  } else if (channel === 'alipay') {
    payParams = buildAlipayPay(order);
  } else if (channel === 'wechat') {
    payParams = buildWechatPay(order);
  } else if (channel === 'stripe') {
    payParams = await buildStripePay(order);
  } else {
    payParams = buildDemoPay(order);
  }
  
  res.json({
    ok: true,
    order: order,
    pay: payParams
  });
}

function buildDemoPay(order) {
  const signBody = `${order.channel}|${order.out_trade_no}|${order.amount_cents}|CREATED`;
  const sig = hmacSign(config.demoSecret, signBody);
  
  return {
    mode: 'demo',
    channel: order.channel,
    qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=DEMO_${order.out_trade_no}`,
    sign: sig,
    message: '演示模式：点击"模拟支付"即可完成支付'
  };
}

function buildAlipayPay(order) {
  if (config.mode === 'real') {
    // 真实支付宝集成
    return {
      mode: 'real',
      channel: 'alipay',
      subject: `${config.plans[order.plan].name} - AI Money Maker`,
      total_amount: (order.amount_cents / 100).toFixed(2),
      out_trade_no: order.out_trade_no,
      notify_url: `${process.env.SITE_URL}/api/notify/alipay`,
      return_url: `${process.env.SITE_URL}/success`
    };
  }
  return buildDemoPay(order);
}

function buildWechatPay(order) {
  if (config.mode === 'real') {
    // 真实微信支付集成
    return {
      mode: 'real',
      channel: 'wechat',
      description: `${config.plans[order.plan].name} - AI Money Maker`,
      out_trade_no: order.out_trade_no,
      amount: { total: order.amount_cents },
      notify_url: `${process.env.SITE_URL}/api/notify/wechat`
    };
  }
  return buildDemoPay(order);
}

async function buildStripePay(order) {
  if (config.mode === 'real' && process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      
      const session = await Stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: config.plans[order.plan].name,
              description: `${config.plans[order.plan].days}天订阅`
            },
            unit_amount: Math.round(order.amount_cents / config.fxRate),
            recurring: { interval: 'month' }
          },
          quantity: 1
        }],
        mode: 'subscription',
        success_url: `${process.env.SITE_URL}/success?order_id=${order.out_trade_no}`,
        cancel_url: `${process.env.SITE_URL}/pricing`,
        metadata: {
          orderId: order.out_trade_no,
          userId: order.uid
        }
      });

      return {
        mode: 'real',
        channel: 'stripe',
        checkout_url: session.url,
        session_id: session.id
      };
    } catch (e) {
      console.error('Stripe error:', e);
      return buildDemoPay(order);
    }
  }
  return buildDemoPay(order);
}

async function handleDemoPay(body, res) {
  const { out_trade_no, uid } = body;
  
  const order = getOrder(out_trade_no);
  if (!order) {
    return res.status(404).json({ ok: false, error: 'ORDER_NOT_FOUND' });
  }
  
  // 构造通知数据
  const notifyBody = {
    out_trade_no: out_trade_no,
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
  
  // 幂等检查
  if (order.status === 'PAID') {
    return res.json({ ok: true, alreadyPaid: true, message: '订单已支付' });
  }
  
  // Demo模式下验证签名
  if (config.mode === 'demo') {
    const expectedSig = generateDemoSign(outTradeNo, data.amount_cents);
    if (!verifySignature(config.demoSecret, 
      `${data.channel}|${outTradeNo}|${data.amount_cents}|PAID`, 
      data.sign)) {
      return res.status(400).json({ ok: false, error: 'SIGN_INVALID' });
    }
  }
  
  // 标记订单为已支付
  order.status = 'PAID';
  order.paid_at = Date.now();
  order.rmb_cents = data.amount_cents;
  saveOrder(order);
  
  // 发放订阅
  const grantResult = await grantSubscription(order);
  
  // 处理推荐奖励
  await processReferralReward(order.uid);
  
  res.json({
    ok: true,
    message: '支付成功',
    out_trade_no: outTradeNo,
    grant: grantResult
  });
}

async function grantSubscription(order) {
  const plan = config.plans[order.plan];
  const user = getUser(order.uid);
  
  const extraMs = plan.days * 24 * 60 * 60 * 1000;
  user.subscribed_until = Math.max(user.subscribed_until || 0, Date.now() + extraMs);
  user.paid_total_cents = (user.paid_total_cents || 0) + (order.amount_cents || plan.priceCNY);
  
  // 重置免费额度（或增加新额度）
  user.credits = config.freeCreditsPerTool;
  
  saveUser(user);
  
  return {
    ok: true,
    plan: order.plan,
    daysAdded: plan.days,
    newExpiry: user.subscribed_until
  };
}

async function processReferralReward(uid) {
  const user = getUser(uid);
  const invite = config.store.invites?.[uid];
  if (!invite || !invite.invited_by_uid) return;
  
  const senderInv = config.store.invites[invite.invited_by_uid];
  if (!senderInv) return;
  
  senderInv.paid_count = (senderInv.paid_count || 0) + 1;
  senderInv.total_paid_cents = (senderInv.total_paid_cents || 0) + 990;
  
  await applyTierRewards(invite.invited_by_uid, senderInv);
}

async function applyTierRewards(uid, inv) {
  const user = getUser(uid);
  if (!user.rewards) user.rewards = {};
  
  let changed = false;
  const now = Date.now();
  const refConfig = config.referral;
  
  // Tier 1: 1位付费 >= 1个月
  if (!user.rewards['r1m'] && inv.paid_count >= refConfig.tier1.minCount) {
    user.subscribed_until = (user.subscribed_until || 0) + refConfig.tier1.rewardDays * 86400000;
    user.rewards['r1m'] = now;
    changed = true;
  }
  
  // Tier 2: 3位付费（每季度 >= 25元）
  if (!user.rewards['r3m'] && inv.paid_count >= refConfig.tier2.minCount && 
      inv.total_paid_cents >= refConfig.tier2.minAmount) {
    user.subscribed_until = (user.subscribed_until || 0) + refConfig.tier2.rewardDays * 86400000;
    user.rewards['r3m'] = now;
    changed = true;
  }
  
  // Tier 3: 10位付费（每位 >= $99/年）
  if (!user.rewards['r1y'] && inv.paid_count >= refConfig.tier3.minCount && 
      inv.total_paid_cents >= refConfig.tier3.minAmount) {
    user.subscribed_until = (user.subscribed_until || 0) + refConfig.tier3.rewardDays * 86400000;
    user.rewards['r1y'] = now;
    changed = true;
  }
  
  if (changed) {
    saveUser(user);
  }
  
  return user;
}

function handleGetStatus(uid, res) {
  const user = getUser(uid);
  const now = Date.now();
  const isSubscribed = user.subscribed_until > now;
  
  res.json({
    ok: true,
    uid: uid,
    isSubscribed: isSubscribed,
    subscribedUntil: user.subscribed_until,
    timeRemaining: isSubscribed ? user.subscribed_until - now : 0,
    paidTotalCents: user.paid_total_cents || 0,
    rewards: user.rewards || {},
    inviteCode: user.invite_code,
    freeCredits: user.credits || config.freeCreditsPerTool
  });
}

function handleGetReferral(uid, res) {
  const user = getUser(uid);
  const invite = config.store.invites?.[uid];
  
  res.json({
    ok: true,
    uid: uid,
    inviteLink: `${process.env.SITE_URL}/invite/${user.invite_code}`,
    inviteCode: user.invite_code,
    paidCount: invite?.paid_count || 0,
    totalPaidCents: invite?.total_paid_cents || 0,
    tiers: {
      tier1: { required: 1, current: invite?.paid_count || 0, achieved: (invite?.paid_count || 0) >= 1 },
      tier2: { required: 3, current: invite?.paid_count || 0, achieved: (invite?.paid_count || 0) >= 3 },
      tier3: { required: 10, current: invite?.paid_count || 0, achieved: (invite?.paid_count || 0) >= 10 }
    }
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

// ============ 辅助函数 ============
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
