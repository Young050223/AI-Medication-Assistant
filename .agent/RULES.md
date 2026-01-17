# 📋 AI用药助手 - 开发规则 (Development Rules)

> **版本**: v1.0.0  
> **创建日期**: 2026-01-17  
> **最后更新**: 2026-01-17

---

## 🚨 核心规则

### 规则 1：禁止破坏性删除

> [!CAUTION]
> 此规则为红线规则，违反将导致严重后果

#### 1.1 禁止行为
- ❌ 直接删除任何源代码文件
- ❌ 删除配置文件
- ❌ 删除用户数据
- ❌ 批量重命名导致文件丢失
- ❌ 覆盖写入重要文件而不备份

#### 1.2 正确做法
- ✅ 废弃文件先移动到 `.deprecated/` 目录
- ✅ 重要修改前先创建备份
- ✅ 使用版本控制(Git)管理所有变更
- ✅ 删除前必须确认并说明原因

#### 1.3 废弃流程
```
需要删除的文件 → 移动到 .deprecated/[日期]/ → 保留7天 → 确认后删除
```

---

### 规则 2：代码质量标准

#### 2.1 模块化Hooks架构

所有React逻辑必须遵循Hooks模块化设计：

```typescript
// ✅ 正确示例：独立的Hook模块
// hooks/useMedication.ts
export function useMedication(medicationId: string) {
  const [medication, setMedication] = useState<Medication | null>(null);
  const [loading, setLoading] = useState(true);
  
  // 获取药物信息
  useEffect(() => {
    fetchMedication(medicationId).then(setMedication);
  }, [medicationId]);
  
  return { medication, loading };
}
```

```typescript
// ❌ 错误示例：逻辑耦合在组件中
// components/MedicationCard.tsx
export function MedicationCard({ id }) {
  // 不要在组件中直接写复杂逻辑
  const [data, setData] = useState(null);
  useEffect(() => { /* 复杂逻辑 */ }, []);
  // ...
}
```

#### 2.2 Hooks目录结构
```
src/
├── hooks/
│   ├── medication/
│   │   ├── useMedication.ts       # 单个药物操作
│   │   ├── useMedicationList.ts   # 药物列表
│   │   └── useMedicationSchedule.ts # 服药计划
│   ├── user/
│   │   ├── useAuth.ts             # 认证相关
│   │   ├── useProfile.ts          # 用户档案
│   │   └── useFamilyAccount.ts    # 家庭账户
│   ├── ai/
│   │   ├── useAIAnalysis.ts       # AI分析
│   │   └── useAIWarning.ts        # AI预警
│   └── common/
│       ├── useLocalStorage.ts     # 本地存储
│       └── useEncryption.ts       # 加密处理
```

#### 2.3 注释规范

**文件头部注释（必须）**：
```typescript
/**
 * @file useMedication.ts
 * @description 药物信息管理Hook，提供药物的增删改查功能
 * @author [开发者]
 * @created 2026-01-17
 * @modified 2026-01-17
 */
```

**函数注释（必须）**：
```typescript
/**
 * 获取药物详细信息
 * @param medicationId - 药物唯一标识符
 * @returns 药物信息对象，包含名称、剂量、服用频率等
 * @throws 当药物ID无效时抛出错误
 * @example
 * const { medication, loading } = useMedication('med-123');
 */
```

**复杂逻辑注释（必须）**：
```typescript
// 检查药物冲突逻辑：
// 1. 遍历用户当前所有在服药物
// 2. 查询冲突数据库，检查是否存在禁忌组合
// 3. 如果发现冲突，返回冲突详情
const checkConflicts = (medications: Medication[]) => {
  // ...
};
```

#### 2.4 代码可读性检查清单
- [ ] 变量命名是否清晰表达其用途？
- [ ] 函数是否遵循单一职责原则？
- [ ] 复杂逻辑是否有注释说明？
- [ ] 是否避免了魔法数字/字符串？
- [ ] 是否使用了TypeScript类型定义？

---

### 规则 3：任务完成通知

#### 3.1 语音通知机制
完成每个小任务后，必须调用macOS终端发送语音通知：

```bash
# 任务完成时执行
say "job done"
```

#### 3.2 通知触发时机
- ✅ 完成每个小任务后

#### 3.3 通知脚本封装
```bash
#!/bin/bash
# scripts/notify.sh
# 用药助手 - 任务完成通知脚本

notify_done() {
    local message="${1:-job done}"
    say "$message"
    # 可选：同时发送系统通知
    osascript -e "display notification \"$message\" with title \"AI用药助手\""
}

notify_done "$1"
```

---

### 规则 4：全程中文沟通

#### 4.1 沟通范围
- ✅ 代码注释：中文
- ✅ 文档撰写：中文（必要处可中英对照）
- ✅ 开发日志：中文
- ✅ 团队交流：中文

#### 4.2 例外情况
- 代码变量名、函数名：英文（遵循编程规范）
- 第三方库/框架术语：保持原文
- 技术标准术语：可使用英文

#### 4.3 Git提交信息规范
```
类型: 简短描述（中文）

详细描述（中文，可选）

类型包括：
- 功能: 新增功能
- 修复: Bug修复
- 优化: 代码优化
- 文档: 文档更新
- 测试: 测试相关
- 配置: 配置变更
```

示例：
```
功能: 添加药物识别OCR模块

- 集成Tesseract OCR引擎
- 支持中英文药品名称识别
- 添加图片预处理增强识别率
```

---

## 📁 附加规则

### 规则 5：Git分支管理
```
main          # 稳定版本
├── develop   # 开发主分支
├── feature/* # 功能分支
├── bugfix/*  # Bug修复分支
└── release/* # 发布分支
```

### 规则 6：文件命名规范
| 类型 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `MedicationCard.tsx` |
| Hook | camelCase + use前缀 | `useMedication.ts` |
| 工具函数 | camelCase | `formatDate.ts` |
| 类型定义 | PascalCase + .types | `Medication.types.ts` |
| 常量 | UPPER_SNAKE_CASE | `API_ENDPOINTS.ts` |

### 规则 7：错误处理
```typescript
// 所有异步操作必须有错误处理
try {
  const result = await fetchData();
} catch (error) {
  // 1. 记录错误日志
  console.error('[模块名] 操作失败:', error);
  // 2. 用户友好提示
  showToast('操作失败，请稍后重试');
  // 3. 上报错误（可选）
  reportError(error);
}
```

### 规则 8：测试要求
- 核心业务逻辑覆盖率 ≥ 90%
- 每个Hook必须有对应测试文件

---

## ✅ 规则检查清单

在每次提交前，请确认：

### 代码层面
- [ ] 无破坏性删除操作
- [ ] 遵循模块化Hooks架构
- [ ] 注释完整清晰
- [ ] TypeScript类型完整

### 沟通层面
- [ ] 注释使用中文
- [ ] 提交信息使用中文
- [ ] 文档使用中文

### 流程层面
- [ ] 通过本地测试
- [ ] 模拟器运行正常
- [ ] 任务完成后发送语音通知

---

**规则生效日期**: 2026年01月17日  
**规则维护人**: 项目负责人
