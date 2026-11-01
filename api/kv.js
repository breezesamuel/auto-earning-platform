/**
 * Vercel KV Database Integration
 * 提供持久化的数据存储解决方案
 */

// 环境变量检查
const IS_DEV = process.env.NODE_ENV === 'development';

// 内存存储 (开发模式或KV不可用时)
const memoryStore = {
  users: {},
  orders: {},
  invites: {},
  subscriptions: {}
};

// KV客户端 (生产环境)
let kvClient = null;

async function initKV() {
  if (process.env.VERCEL_KV_URL) {
    try {
      // 动态导入 @vercel/kv
      const { get, set, del, incr } = await import('@vercel/kv');
      return { get, set, del, incr };
    } catch (e) {
      console.log('KV not available, using memory store');
      return null;
    }
  }
  return null;
}

// 初始化KV
initKV().then(client => {
  kvClient = client;
});

// ============ 用户操作 ============

async function getUser(uid) {
  // 尝试从KV获取
  if (kvClient) {
    const data = await kvClient.get(`user:${uid}`);
    if (data) return data;
  }
  
  // 回退到内存存储
  if (!memoryStore.users[uid]) {
    memoryStore.users[uid] = {
      uid,
      subscribed_until: 0,
      paid_total_cents: 0,
      credits: 10,
      rewards: {},
      invite_code: `INV-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      created_at: Date.now()
    };
  }
  return memoryStore.users[uid];
}

async function saveUser(user) {
  // 保存到KV
  if (kvClient) {
    await kvClient.set(`user:${user.uid}`, user, { ex: 86400 * 365 }); // 1年过期
  }
  // 同步到内存
  memoryStore.users[user.uid] = user;
}

// ============ 订单操作 ============

async function getOrder(outTradeNo) {
  if (kvClient) {
    const data = await kvClient.get(`order:${outTradeNo}`);
    if (data) return data;
  }
  return memoryStore.orders?.[outTradeNo] || null;
}

async function saveOrder(order) {
  if (kvClient) {
    await kvClient.set(`order:${order.out_trade_no}`, order, { ex: 86400 }); // 24小时过期
  }
  if (!memoryStore.orders) memoryStore.orders = {};
  memoryStore.orders[order.out_trade_no] = order;
}

// ============ 邀请操作 ============

async function getInvite(inviteCode) {
  if (kvClient) {
    return await kvClient.get(`invite:${inviteCode}`);
  }
  // 遍历内存中的invites查找
  for (const [key, value] of Object.entries(memoryStore.invites || {})) {
    if (value.invite_code === inviteCode) return value;
  }
  return null;
}

async function saveInvite(invite) {
  if (kvClient) {
    await kvClient.set(`invite:${invite.invite_uid}`, invite, { ex: 86400 * 365 });
  }
  if (!memoryStore.invites) memoryStore.invites = {};
  memoryStore.invites[invite.invite_uid] = invite;
}

// ============ 订阅操作 ============

async function getSubscription(userId) {
  if (kvClient) {
    return await kvClient.get(`sub:${userId}`);
  }
  return memoryStore.subscriptions?.[userId] || null;
}

async function saveSubscription(subscription) {
  if (kvClient) {
    await kvClient.set(`sub:${subscription.userId}`, subscription, { ex: 86400 * 365 });
  }
  if (!memoryStore.subscriptions) memoryStore.subscriptions = {};
  memoryStore.subscriptions[subscription.userId] = subscription;
}

// ============ 统计数据 ============

async function incrementCount(key) {
  if (kvClient) {
    return await kvClient.incr(key);
  }
  if (!memoryStore.counters) memoryStore.counters = {};
  memoryStore.counters[key] = (memoryStore.counters[key] || 0) + 1;
  return memoryStore.counters[key];
}

// ============ 导出 ============
module.exports = {
  getUser,
  saveUser,
  getOrder,
  saveOrder,
  getInvite,
  saveInvite,
  getSubscription,
  saveSubscription,
  incrementCount
};
