# 阶段交付标准模板（SOP）

> 目的：统一“立项/分析/需求设计/视觉设计/开发/验收”阶段产物，禁止模板化空文档与伪证据。

## A. INIT（项目经理）
- 交付物：`项目章程.md`
- 必填章节：项目背景与目标、范围定义（In/Out of Scope）、角色职责、治理机制、风险与应急。
- 验收标准：目标可量化、范围边界可执行、责任人明确。

## B. ANALYSIS（需求分析师 + 项目经理）
- 交付物：`需求分析文档.md`（分析师）、`项目排期方案.md`（PM）。
- 必填章节：问题定义、用户场景、约束与风险、验收指标、里程碑与关键路径、RACI。
- 验收标准：分析与排期可追溯到同一需求源，排期含依赖与缓冲策略。

## C. DESIGN（产品 + 设计）
- 交付物：`产品需求文档(PRD).md`（产品）、`设计审查卡.md` + `视觉定稿单页.preview.html.md`（设计）。
- 必填章节：PRD 功能清单（MVP/增强）、非目标、页面结构、状态反馈矩阵、响应式策略、可访问性检查。
- 验收标准：PRD 来自分析文档；视觉稿有可渲染预览；设计有 Stitch/Figma 证据。

## D. DEV（架构 + 研发）
- 交付物：`技术方案与选型.md`（架构）、`实现结果说明.md` + `运行地址与部署说明.md`（研发）。
- 必填章节：架构决策、接口契约、数据模型、变更证据、验证命令与结果、回滚方案。
- 验收标准：页面/接口/代码路径/验证日志四类证据齐全。

## E. ACCEPT（QA）
- 交付物：`测试报告.md`、`产品说明文档回填.md`。
- 必填章节：测试范围、用例矩阵、结果统计、缺陷与风险、发布建议、需求-交付映射。
- 验收标准：通过/失败有依据，阻断项可复现，回填可作为下一轮输入。

## 参考标准（用于模板约束）
- ISO/IEC/IEEE 29148（需求工程）：https://www.iso.org/standard/72089.html
- ISO 21502（项目管理指导）：https://www.iso.org/standard/74947.html
- ISO 31000（风险管理）：https://www.iso.org/standard/65694.html
- WCAG 2.2（可访问性）：https://www.w3.org/TR/WCAG22/
- OpenAPI Specification（接口契约）：https://spec.openapis.org/oas/
- IEEE 1016（软件设计描述）：https://standards.ieee.org/standard/1016-2009.html
- ISO/IEC/IEEE 29119（软件测试）：https://standards.ieee.org/wp-content/uploads/import/documents/tocs/ISO_IEC_IEEE_29119.pdf

## 强制执行规则
- 未完成上游必需交付不得进入下一阶段。
- 交付物角色归属必须匹配阶段 SOP，不允许错位代写。
- 交付物必须包含真实工具/技能/模型执行证据，不允许占位文本。
