# Tasks: facade 1:1 会话记忆读缝

## 1. 接缝实现

- [x] 1.1 `services/wanxing-facade/memory.js`：`createMemorySeam`（/digest 读取 + /admin/mint 铸 person 令牌 + 按邮箱缓存 + 5s 超时 + 降级开 + `WANXING_FACADE_MEMORY_DIGEST` 总闸）
- [x] 1.2 兼容 `CELL_MEMORY_*` 与 `FD_MEMORY_*` 两种环境拼法（复用既有 secret，不新增令牌）
- [x] 1.3 `services/wanxing-facade/chat.js`：`textOf()` 之后统一注入；`tier=anon` 恒不注入；`message/send` 与 `message/stream` 同源

## 2. 测试

- [x] 2.1 登录访客回合带本人 digest（mint 命名空间=`u/<visitor>`、query=原话、project=default）
- [x] 2.2 匿名访客零记忆请求且文本逐字不变（真签 `signEphemeral` 票据并打开 per-agent 匿名闸，避免静默早退的假绿）
- [x] 2.3 总闸关断零请求；未配置即 inert；记忆失败回合照答
- [x] 2.4 既有 50 测零回归（默认关时行为不变），合计 55 绿

## 3. 上产与验收

- [x] 3.1 镜像 sha-602b1a2（源 2306514）→ ccr digest bb330199 → GitOps 6a2e5ca → pod 1/1 Running、接口 200
- [x] 3.2 生产实证：pod 内 `createMemorySeam()` enabled=true；真 owner 块 1292 字含名份引用；游客路径原样返回
- [x] 3.3 母仓台账 §15.77 落账
