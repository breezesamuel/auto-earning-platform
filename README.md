# Auto-Earning Platform - Vercel Deployment

## AI驱动的自动赚钱平台

集成丙大山AI Agent支付系统的完整商业订阅墙解决方案。

### 功能特性
- 三档订阅套餐：月度¥29、季度¥75、年度¥99
- 四重支付渠道：Demo/支付宝/微信/Stripe
- 推荐奖励系统：三级分润机制
- 计量计费引擎：按量扣费，实时结算

### API端点
- `GET /api/plans` - 获取套餐信息
- `POST /api/create-order` - 创建支付订单
- `POST /api/demo-pay` - Demo模式支付
- `GET /api/status/:userId` - 查询用户状态
- `POST /api/callback` - 支付回调处理

### 环境变量
- `PAY_MODE=demo` - 启用演示模式
- `CURRENCY=CNY` - 货币单位
- `EXCHANGE_RATE=7.2` - 汇率设置
