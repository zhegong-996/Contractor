# Contractor 各模块业务流程

整条链路从「进来源」到「沉淀知识」见 [README 的一件工作怎样走完](../README.md#一件工作怎样走完)。本文把链路拆成可独立运行的模块，用时序图说明每个模块的参与方、决定和回传。图中的 `核心` 指 Contractor 业务核心（项目、权限、版本、积分、人审），`调度器` 是当前启用的单一执行调度器。

## 1. 登录、身份与平台角色

```mermaid
sequenceDiagram
    actor U as 成员
    participant IM as 主 IM 渠道
    participant A as 登录回调
    participant C as 核心
    participant AD as 管理员
    U->>IM: 扫码或授权
    IM->>A: 回传 code + state
    A->>C: 校验应用、身份与组织
    alt 已有账号
        C->>U: 建立会话，回到原链接
    else 新身份
        C->>AD: 生成开通申请待办
        AD->>C: 审批角色、停用或撤销会话
    end
```

## 2. 渠道接入、过滤与归属

```mermaid
sequenceDiagram
    participant S as 飞书 / GitHub / 其他 IM
    participant IN as 持久入站
    participant F as 过滤器
    participant H as 待我处理
    participant C as 核心
    S->>IN: 事件先落盘再处理
    IN->>IN: 按渠道消息标识与修订去重
    IN->>F: 归一化地址与发送者
    F->>F: 绑定项目成员，跳过机器人自身
    alt 明确引用或委托
        F->>C: 续原单或按职责开单
    else 未点名反馈
        F->>C: 按时间窗归纳进主题
    else 归属冲突
        F->>H: 保留原消息，交维护人确认
    end
```

## 3. 发起协作与路由派工

```mermaid
sequenceDiagram
    actor U as 成员
    participant R as Router
    participant H as 待我处理
    participant C as 核心
    U->>R: 委托、咨询或接续
    R->>R: 显式指定 → 主题 → 父主题 → 项目职责
    alt 唯一且在岗候选
        R->>C: 给出执行人与业务决定人
    else 多候选、缺资料或待接单
        R->>H: 生成对应待办
    end
    C->>C: 领取时复核模型、设备、额度与授权
```

## 4. Worker 执行与回执

```mermaid
sequenceDiagram
    participant S as 调度器
    participant W as 本机 / 远程 Worker
    participant C as 核心
    S->>W: 领取运行，冻结当轮上下文
    W->>W: 装配资料、技能与工作目录
    W->>C: 回执成果、Token、积分与停止证明
    alt 断线或回执丢失
        W->>S: 重连后补写原运行
    end
    C->>C: 幂等去重，不重复派工或扣分
```

## 5. GitHub 交付与 CI

```mermaid
sequenceDiagram
    participant W as Worker
    participant GH as GitHub
    participant C as 核心
    W->>GH: 在授权路径内提交或推送分支
    GH->>C: 提交、PR 与 CI 事件
    C->>C: 把版本绑定到对应 SHA 与检查
    C->>C: 区分待推送、待 PR、等待 CI
```

## 6. 会话与 Agent 咨询

```mermaid
sequenceDiagram
    actor U as 成员
    participant CV as 会话（群聊 / 个人）
    participant AG as Agent
    participant C as 核心
    U->>CV: @ 提及 Agent 或个人对话
    CV->>AG: 携带主题上下文与授权资料
    AG->>CV: 回复并附出处
    CV->>U: 原会话回传
    U->>C: 可选公开到飞书或选定 IM
```

## 7. 验收与知识回流

```mermaid
sequenceDiagram
    actor U as 发起人
    participant C as 核心
    participant K as 知识
    participant KO as 知识负责人
    U->>C: 核对当版证据与逐项检查
    alt 打回修改
        C->>C: 原单生成下一版
    else 验收通过
        C->>K: 生成知识候选
        K->>K: 提炼可复用做法与适用条件
        KO->>K: 采用为现行版本
        K->>C: 供后续工单在授权内引用
    end
```

## 8. 运维、恢复与部署

```mermaid
sequenceDiagram
    actor OP as 运维
    participant C as 核心
    participant S as 独立服务
    OP->>C: 停入口 / 索引 / 工作台
    S->>S: 重启后补读消息、补写回执
    C->>C: 按原消息与工单引用去重
    C->>C: 旧执行确认停止后接续原单
```

## 模块与代码对照

| 模块 | 时序图 | 主要实现 |
| --- | --- | --- |
| 登录与身份 | §1 | [im-login](../src/workbench/im-login.ts) · [permission-admin](../src/workbench/permission-admin.ts) |
| 渠道与过滤 | §2 | [intake](../src/workbench/intake.ts) · [channel-workflow](../src/workbench/channel-workflow.ts) |
| 路由派工 | §3 | [router](../src/workbench/router.ts) · [dispatch-workflow](../src/workbench/dispatch-workflow.ts) |
| 执行与回执 | §4 | [execution/scheduler](../src/workbench/execution/scheduler.ts) · [execution-receipts](../src/workbench/execution-receipts.ts) |
| 交付与 CI | §5 | [github-delivery](../src/workbench/github-delivery.ts) · [delivery-evidence](../src/workbench/delivery-evidence.ts) |
| 会话与咨询 | §6 | [conversation-index](../src/workbench/conversation-index.ts) · [topic-context](../src/workbench/topic-context.ts) |
| 验收与知识 | §7 | [ticket-acceptance](../src/workbench/ticket-acceptance.ts) · [knowledge](../src/workbench/knowledge.ts) |
| 运维与恢复 | §8 | [feishu-ingress-service](../src/workbench/feishu-ingress-service.ts) · [octop-index-service](../src/workbench/octop-index-service.ts) |
