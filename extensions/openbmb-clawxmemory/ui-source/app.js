import { renderTraceI18nText } from "./trace-i18n.js";

/* ── i18n ────────────────────────────────────────────────── */

const LOCALES = {
  zh: {
    "nav.project": "项目记忆",
    "nav.tmp": "Tmp 暂存",
    "nav.user": "用户画像",
    "nav.memory_trace": "记忆追踪",
    "nav.lastIndexed": "最近索引",
    "nav.waiting": "等待索引",
    "topbar.title": "ClawXMemory",
    "topbar.idle": "等待操作",
    "topbar.refresh": "刷新",
    "topbar.build": "索引同步",
    "topbar.dream": "记忆 Dream",
    "topbar.overview": "仪表盘",
    "topbar.settings": "设置",
    "stream.searchPlaceholder": "搜索当前视图",
    "stream.search": "搜索",
    "stream.clear": "清空",
    "stream.items": "{0} 条",
    "detail.title": "记录详情",
    "detail.empty": "选择一条记忆查看详情",
    "detail.profile": "Profile",
    "detail.preferences": "Preferences",
    "detail.constraints": "Constraints",
    "detail.relationships": "Relationships",
    "detail.notes": "Notes",
    "detail.rule": "Rule",
    "detail.why": "Why",
    "detail.howToApply": "How to apply",
    "detail.currentStage": "Current Stage",
    "detail.decisions": "Decisions",
    "detail.nextSteps": "Next Steps",
    "detail.blockers": "Blockers",
    "detail.timeline": "Timeline",
    "detail.sourceFiles": "Source Files",
    "detail.feedbackRules": "Feedback Rules",
    "detail.projectFiles": "项目记忆文件",
    "detail.feedbackFiles": "协作反馈文件",
    "detail.backToProject": "返回项目",
    "detail.backToList": "返回项目列表",
    "settings.advanced": "参数设置",
    "settings.autoIndexInterval": "自动索引间隔（小时）",
    "settings.autoDreamInterval": "自动 Dream 间隔（小时）",
    "settings.scheduleHint": "0 表示关闭自动任务",
    "settings.autoDreamHint": "只有自上次 Dream 以来有记忆文件更新时，自动 Dream 才会真正执行。",
    "settings.save": "保存设置",
    "settings.theme": "主题",
    "settings.language": "语言",
    "settings.accentColor": "主题色",
    "settings.dataManagement": "数据管理",
    "settings.export": "导出迁移包",
    "settings.import": "导入迁移包",
    "settings.clear": "清除记忆",
    "settings.theme.light": "浅色",
    "settings.theme.dark": "深色",
    "settings.theme.auto": "跟随系统",
    "overview.title": "运行概览",
    "overview.group.memory": "记忆概况",
    "overview.group.recall": "最近运行",
    "overview.group.warning": "异常提示",
    "overview.formalProjectCount": "项目记忆",
    "overview.tmpTotalFiles": "未归档记忆",
    "overview.userProfileCount": "用户画像",
    "overview.pendingSessions": "待索引会话",
    "overview.lastIndexedAt": "上次索引",
    "overview.lastDreamAt": "最近 Dream",
    "overview.lastDreamStatus": "Dream 状态",
    "overview.lastDreamSummary": "Dream 摘要",
    "overview.warning.viewDiagnostics": "查看诊断",
    "overview.warning.conflictSummary": "检测到 {0} 个工作区边界冲突：{1}",
    "overview.warning.issueSummary": "检测到运行异常：{0}",
    "overview.diagnostics.issues": "问题",
    "overview.diagnostics.conflictingFiles": "冲突文件",
    "overview.diagnostics.startupRepairMessage": "启动修复消息",
    "confirm.sync.title": "索引同步",
    "confirm.sync.body": "将扫描最近对话并把可归类内容写入文件式 memory。",
    "confirm.sync.ok": "开始同步",
    "confirm.dream.title": "记忆 Dream",
    "confirm.dream.body": "Dream 会整理、重写、合并并删除冗余的已索引项目记忆，不会额外生成项目摘要层。",
    "confirm.dream.ok": "开始 Dream",
    "confirm.clear.title": "清除记忆",
    "confirm.clear.body": "此操作将删除所有记忆数据，且不可撤销。确定继续吗？",
    "confirm.clear.ok": "确认清除",
    "confirm.import.title": "导入迁移包",
    "confirm.import.body": "这会用导入的迁移包完整替换当前本地记忆。确定继续吗？",
    "confirm.import.ok": "确认导入",
    "confirm.cancel": "取消",
    "confirm.memory.delete.title": "删除记忆",
    "confirm.memory.delete.body": "此操作会永久删除这条已废弃记忆，且不可恢复。确定继续吗？",
    "confirm.memory.delete.ok": "删除",
    "confirm.memory.deprecate.title": "标记废弃",
    "confirm.memory.deprecate.body": "这条记忆会退出当前工作记忆，但会保留在磁盘中，可稍后恢复。确定继续吗？",
    "confirm.memory.deprecate.ok": "标记废弃",
    "confirm.memory.restore.title": "恢复记忆",
    "confirm.memory.restore.body": "这条记忆会重新参与默认列表、计数与 recall。确定继续吗？",
    "confirm.memory.restore.ok": "恢复",
    "prompt.editProjectMeta.title": "编辑项目信息",
    "prompt.editProjectMeta.body": "修改项目 meta，不会直接重写已有记忆正文。若项目名变化，旧名称会自动加入 aliases。",
    "prompt.editProjectMeta.projectName": "项目名称",
    "prompt.editProjectMeta.description": "项目描述",
    "prompt.editProjectMeta.aliases": "项目别名（每行一个）",
    "prompt.editProjectMeta.status": "项目状态",
    "prompt.editProjectMeta.ok": "保存项目信息",
    "prompt.editEntry.title.project": "编辑项目记忆",
    "prompt.editEntry.title.feedback": "编辑协作反馈",
    "prompt.editEntry.body": "只编辑结构化字段，不直接暴露原始 markdown。",
    "prompt.editEntry.name": "记忆名称",
    "prompt.editEntry.description": "记忆描述",
    "prompt.editEntry.stage": "Current Stage",
    "prompt.editEntry.decisions": "Decisions（每行一个）",
    "prompt.editEntry.constraints": "Constraints（每行一个）",
    "prompt.editEntry.nextSteps": "Next Steps（每行一个）",
    "prompt.editEntry.blockers": "Blockers（每行一个）",
    "prompt.editEntry.timeline": "Timeline（每行一个）",
    "prompt.editEntry.notes": "Notes（每行一个）",
    "prompt.editEntry.rule": "Rule",
    "prompt.editEntry.why": "Why",
    "prompt.editEntry.howToApply": "How to apply",
    "prompt.editEntry.ok": "保存记忆",
    "prompt.archiveExisting.title": "归档到现有项目",
    "prompt.archiveExisting.body": "把这条未归档记忆归到一个已有正式项目，不会触发 Dream。",
    "prompt.archiveExisting.label": "目标项目",
    "prompt.archiveExisting.ok": "归档",
    "prompt.archiveNew.title": "归档为新项目",
    "prompt.archiveNew.body": "将这条未归档项目记忆提升为新的正式项目。",
    "prompt.archiveNew.label": "新项目名称",
    "prompt.archiveNew.placeholder": "输入新项目名称",
    "prompt.archiveNew.ok": "创建并归档",
    "action.editProjectMeta": "编辑项目信息",
    "action.editMemory": "编辑记忆",
    "action.viewDetail": "查看详情",
    "action.deleteMemory": "删除记忆",
    "action.deprecateMemory": "标记废弃",
    "action.restoreMemory": "恢复记忆",
    "action.archiveToProject": "归档到现有项目",
    "action.archiveAsProject": "归档为新项目",
    "action.unavailable": "当前没有可用操作",
    "status.refreshing": "刷新中…",
    "status.refreshed": "已刷新",
    "status.loading": "加载中…",
    "status.ready": "已就绪",
    "status.building": "同步中…",
    "status.built": "已同步 · captured sessions {0} / written memories {1} / project {2} / feedback {3} / user {4}",
    "status.dreaming": "Dream 整理中…",
    "status.dreamed": "Dream 完成 · {0}",
    "status.dreamFailed": "Dream 失败：{0}",
    "status.clearing": "清空中…",
    "status.cleared": "已清空本地记忆",
    "status.exporting": "导出中…",
    "status.exported": "已导出迁移包 · {0}",
    "status.exportFailed": "导出失败：{0}",
    "status.importing": "导入中…",
    "status.imported": "已导入迁移包 · managed files {0} / memory files {1} / project {2} / feedback {3} / user {4}",
    "status.importInvalid": "导入文件不是有效的记忆迁移包",
    "status.importFailed": "导入失败：{0}",
    "status.settingsSaved": "设置已保存",
    "status.searching": "搜索中…",
    "status.searched": "搜索完成",
    "status.loadFail": "加载失败：{0}",
    "status.memoryActionRunning": "正在更新记忆…",
    "status.memoryActionDone": "{0}",
    "status.memoryActionFailed": "记忆更新失败：{0}",
    "level.project.label": "项目记忆",
    "level.tmp.label": "Tmp 暂存",
    "level.user.label": "用户画像",
    "level.memory_trace.label": "记忆追踪",
    "level.project.empty": "暂无项目记忆",
    "level.tmp.empty": "暂无 Tmp 暂存记忆",
    "level.user.empty": "暂无用户画像记忆",
    "level.memory_trace.empty": "暂无记忆追踪案例",
    "board.project": "项目记忆",
    "board.project.unarchived": "未归档记忆",
    "board.project.deprecatedProjectFiles": "已废弃项目记忆",
    "board.project.deprecatedFeedbackFiles": "已废弃协作反馈",
    "board.project.deprecatedTmpFiles": "已废弃未归档记忆",
    "board.tmp": "Tmp 暂存",
    "board.tmp.manifest": "_tmp 索引",
    "board.tmp.projectFiles": "待整理项目文件",
    "board.tmp.feedbackFiles": "待整理协作反馈",
    "board.user": "用户画像",
    "board.memoryTrace": "记忆追踪",
    "board.user.empty": "暂无可展示的用户画像",
    "board.user.sources": "来源文件",
    "board.memoryTrace.empty": "暂无真实对话案例",
    "board.memoryTrace.emptyIndex": "暂无索引追溯记录",
    "board.memoryTrace.emptyDream": "暂无 Dream 追溯记录",
    "board.memoryTrace.selectCase": "选择案例",
    "board.memoryTrace.selectIndexTrace": "选择索引批次",
    "board.memoryTrace.selectDreamTrace": "选择 Dream 运行",
    "board.memoryTrace.modeRecall": "Recall",
    "board.memoryTrace.modeIndex": "Index",
    "board.memoryTrace.modeDream": "Dream",
    "board.memoryTrace.filterAll": "全部触发",
    "board.memoryTrace.filterManual": "手动触发",
    "board.memoryTrace.filterExplicitRemember": "显式记住",
    "board.memoryTrace.filterManualSync": "手动同步",
    "board.memoryTrace.filterScheduled": "自动定时",
    "board.memoryTrace.query": "问题",
    "board.memoryTrace.session": "会话",
    "board.memoryTrace.mode": "模式",
    "board.memoryTrace.route": "召回路由",
    "board.memoryTrace.trigger": "触发来源",
    "board.memoryTrace.status": "状态",
    "board.memoryTrace.kind": "步骤类型",
    "board.memoryTrace.injected": "注入",
    "board.memoryTrace.started": "开始",
    "board.memoryTrace.finished": "结束",
    "board.memoryTrace.context": "注入上下文",
    "board.memoryTrace.tools": "工具活动",
    "board.memoryTrace.answer": "最终回答",
    "board.memoryTrace.flow": "推理过程",
    "board.memoryTrace.batchWindow": "批次时间范围",
    "board.memoryTrace.snapshot": "Dream 前快照",
    "board.memoryTrace.mutations": "实际写入/删除",
    "board.memoryTrace.rewrittenProjects": "重写项目",
    "board.memoryTrace.deletedProjects": "删除项目",
    "board.memoryTrace.deletedFiles": "删除文件",
    "board.memoryTrace.snapshotFormalProjects": "正式项目",
    "board.memoryTrace.snapshotTmpProjectFiles": "Tmp 项目文件",
    "board.memoryTrace.snapshotTmpFeedbackFiles": "Tmp 反馈文件",
    "board.memoryTrace.snapshotFormalProjectFiles": "正式项目文件",
    "board.memoryTrace.snapshotFormalFeedbackFiles": "正式反馈文件",
    "board.memoryTrace.snapshotHasUserProfile": "存在用户画像",
    "board.memoryTrace.storedResults": "最终写入",
    "board.memoryTrace.focusTurns": "焦点用户轮次",
    "board.memoryTrace.indexSelectorMeta": "{0} · {1} 段 · 已写入 {2} 项",
    "board.memoryTrace.dreamSelectorMeta": "正式项目 {0} 个 · 重写 {1} 个 · 删除文件 {2} 个",
    "board.memoryTrace.noTrace": "该案例没有可展示的 recall trace。",
    "board.memoryTrace.noStep": "该步骤没有可展示的结构化细节。",
    "board.memoryTrace.noPromptDebug": "该步骤没有模型 Prompt 调试数据，通常表示它是本地代码判断步骤。",
    "board.memoryTrace.promptHint": "完整 Prompt 调试可在下方展开。",
    "board.project.feedbackCount": "{0} 条反馈",
    "board.project.memoryCount": "{0} 条项目记忆",
    "board.memoryTrace.promptDebug": "完整 Prompt 调试",
    "board.memoryTrace.systemPrompt": "系统 Prompt",
    "board.memoryTrace.userPrompt": "用户 Prompt",
    "board.memoryTrace.rawOutput": "模型原始输出",
    "board.memoryTrace.parsedResult": "解析结果",
    "meta.type": "Type",
    "meta.scope": "Scope",
    "meta.projectId": "Project",
    "meta.updatedAt": "Updated",
    "meta.capturedAt": "Captured",
    "meta.sessionKey": "Session",
    "meta.dreamAttempts": "Dream Attempts",
    "meta.path": "Path",
    "meta.file": "File",
    "meta.counts": "文件数",
    "meta.global": "Global",
    "meta.project": "Project",
    "common.none": "无",
    "common.unknown": "未知",
    "common.yes": "是",
    "common.no": "否",
    "type.user": "User",
    "type.feedback": "Feedback",
    "type.project": "Project",
    "scope.global": "Global",
    "scope.project": "Project",
    "recall.llm": "LLM 快选",
    "recall.none": "无注入",
    "path.auto": "自动回答",
    "path.explicit": "显式检索",
    "dream.status.never": "尚未运行",
    "dream.status.running": "运行中",
    "dream.status.success": "成功",
    "dream.status.skipped": "已跳过",
    "dream.status.failed": "失败",
    "startup.idle": "空闲",
    "startup.running": "修复中",
    "startup.failed": "失败",
    "runtime.healthy": "正常",
    "runtime.unhealthy": "异常",
    "boundary.ready": "正常",
    "boundary.isolated": "已隔离",
    "boundary.conflict": "冲突",
    "boundary.warning": "告警",
    "route.none": "无记忆",
    "route.user": "用户画像",
    "route.project_memory": "项目记忆",
    "project.active": "进行中",
    "project.planned": "计划中",
    "project.in_progress": "进行中",
    "project.done": "已完成",
    "trace.step.recall_start": "Recall 开始",
    "trace.step.memory_gate": "记忆门控",
    "trace.step.user_base_loaded": "用户基线已加载",
    "trace.step.project_shortlist_built": "项目候选集已生成",
    "trace.step.project_selected": "项目已选定",
    "trace.step.manifest_scanned": "Manifest 已扫描",
    "trace.step.manifest_selected": "Manifest 已选定",
    "trace.step.files_loaded": "文件已加载",
    "trace.step.context_rendered": "上下文已生成",
    "trace.step.recall_skipped": "Recall 已跳过",
    "trace.step.cache_hit": "命中缓存",
    "trace.step.index_start": "Index 开始",
    "trace.step.batch_loaded": "批次已加载",
    "trace.step.focus_turns_selected": "焦点轮次已选定",
    "trace.step.turn_classified": "轮次已分类",
    "trace.step.candidate_validated": "候选已校验",
    "trace.step.candidate_grouped": "候选已分组",
    "trace.step.candidate_persisted": "候选已写入",
    "trace.step.user_profile_rewritten": "用户画像已重写",
    "trace.step.index_finished": "Index 已完成",
    "trace.step.dream_start": "Dream 开始",
    "trace.step.snapshot_loaded": "快照已加载",
    "trace.step.global_plan_generated": "全局计划已生成",
    "trace.step.global_plan_validated": "全局计划已校验",
    "trace.step.project_rewrite_generated": "项目重写已生成",
    "trace.step.project_mutations_applied": "项目变更已应用",
    "trace.step.manifests_repaired": "Manifest 已修复",
    "trace.step.dream_finished": "Dream 已结束",
    "trace.step.unknown": "Trace 步骤",
    "trace.detail.recall_inputs": "Recall 输入",
    "trace.detail.recent_user_messages": "最近用户消息",
    "trace.detail.route": "路由",
    "trace.detail.user_profile": "用户画像",
    "trace.detail.source_files": "来源文件",
    "trace.detail.project_shortlist": "项目候选集",
    "trace.detail.recent_user_texts": "最近用户文本",
    "trace.detail.shortlist_candidates": "候选项目",
    "trace.detail.project_selection": "项目选择",
    "trace.detail.manifest_scan": "Manifest 扫描",
    "trace.detail.sorted_candidates": "排序候选",
    "trace.detail.manifest_candidate_ids": "Manifest 候选 ID",
    "trace.detail.selected_file_ids": "已选文件 ID",
    "trace.detail.selection_summary": "选择摘要",
    "trace.detail.requested_ids": "请求的 ID",
    "trace.detail.loaded_files": "已加载文件",
    "trace.detail.truncated_files": "截断文件",
    "trace.detail.missing_ids": "缺失的 ID",
    "trace.detail.context_summary": "上下文摘要",
    "trace.detail.injected_blocks": "注入区块",
    "trace.detail.recall_query": "Recall 查询",
    "trace.detail.skip_reason": "跳过原因",
    "trace.detail.batch_summary": "批次摘要",
    "trace.detail.batch_context": "批次上下文",
    "trace.detail.focus_selection_summary": "焦点选择摘要",
    "trace.detail.focus_turn": "焦点轮次 {0}",
    "trace.detail.focus_user_turn": "焦点用户轮次",
    "trace.detail.classification_result": "分类结果",
    "trace.detail.classifier_candidates": "分类候选",
    "trace.detail.discarded_reasons": "丢弃原因",
    "trace.detail.raw_candidates": "原始候选",
    "trace.detail.normalized_candidates": "归一化候选",
    "trace.detail.discarded_candidates": "已丢弃候选",
    "trace.detail.grouping_result": "分组结果",
    "trace.detail.persisted_files": "已写入文件",
    "trace.detail.index_error": "Index 错误",
    "trace.detail.user_profile_result": "用户画像结果",
    "trace.detail.user_rewrite_error": "用户重写错误",
    "trace.detail.run_trigger": "运行触发",
    "trace.detail.dream_snapshot": "Dream 快照",
    "trace.detail.project_memory_snapshot": "项目记忆快照",
    "trace.detail.final_project_plan": "最终项目计划",
    "trace.detail.deleted_formal_projects": "删除的正式项目",
    "trace.detail.deleted_memory_files": "删除的记忆文件",
    "trace.detail.project_meta_before_after": "项目 Meta 前后对比",
    "trace.detail.retained_source_files": "保留的源文件",
    "trace.detail.rewritten_files": "重写后的文件",
    "trace.detail.deleted_source_files": "删除的源文件",
    "trace.detail.written_files": "写入的文件",
    "trace.detail.deleted_file_previews": "删除文件预览",
    "trace.detail.user_profile_before": "用户画像（之前）",
    "trace.detail.user_profile_after": "用户画像（之后）",
    "trace.detail.stored_results": "最终写入结果",
    "trace.text.recall_start.output.runtime_inspected": "运行时在尝试检索前先检查了当前轮次。",
    "trace.text.recall_skipped.output.memory_write_turn": "自动 Recall 未运行，因为这一轮是记忆写入请求。",
    "trace.text.recall_skipped.output.reason": "自动 Recall 未运行，因为 {0}。",
    "trace.text.recall_skipped.output.interrupted_by_new_turn": "出现了更新的用户轮次，这个 case 在完成前被中断。",
    "trace.text.recall_skipped.title.interrupted": "Recall 已中断",
    "trace.text.user_base_loaded.input.global_user_profile": "全局用户画像",
    "trace.text.user_base_loaded.output.attached": "已附加精简版全局用户画像。",
    "trace.text.user_base_loaded.output.missing": "当前还没有可用的精简版全局用户画像。",
    "trace.text.project_shortlist_built.input": "共有 {0} 个正式项目",
    "trace.text.project_shortlist_built.output": "已准备好 {0} 个候选项目。",
    "trace.text.project_selected.input": "候选项目 {0} 个",
    "trace.text.project_selected.output.none_selected": "这次查询没有选出正式项目。",
    "trace.text.project_selected.output.not_required": "当前 recall 路由不需要项目选择。",
    "trace.text.manifest_scanned.output.ready": "已准备好 {0} 条 recall header。",
    "trace.text.manifest_scanned.output.with_limit": "已准备好 {0} 条 recall header（前 {1} / 共 {2}）。",
    "trace.text.manifest_scanned.output.no_project_selected": "因为没有选出正式项目，项目 recall 被跳过了。",
    "trace.text.manifest_scanned.output.not_required": "当前 recall 路由不需要项目 manifest。",
    "trace.text.manifest_selected.input": "{0} 条条目",
    "trace.text.manifest_selected.output": "已选出 {0} 个文件 ID。",
    "trace.text.files_loaded.input": "请求了 {0} 个文件",
    "trace.text.files_loaded.output": "已加载 {0} 个文件。",
    "trace.text.context_rendered.input.with_user_base": "{0} 个文件 + 用户基线",
    "trace.text.context_rendered.input.no_user_base": "{0} 个文件 + 无用户基线",
    "trace.text.context_rendered.output.prepared": "记忆上下文已准备完成。",
    "trace.text.context_rendered.no_memory_context": "没有注入任何记忆上下文。",
    "trace.text.recall_skipped.query_does_not_need_memory": "这个查询不需要长期记忆。",
    "trace.text.index_start.output.preparing_batch": "正在为 {0} 准备批次索引。",
    "trace.text.batch_loaded.input": "{0} 段，从 {1} 到 {2}",
    "trace.text.batch_loaded.output": "已把 {0} 条消息载入批次上下文。",
    "trace.text.focus_turns_selected.input": "这一批共有 {0} 个用户轮次。",
    "trace.text.focus_turns_selected.output.classifying": "这些用户轮次会逐条进入分类。",
    "trace.text.focus_turns_selected.output.no_user_turns": "没有发现用户轮次；这一批会直接标记为已索引，不写入记忆。",
    "trace.text.candidate_validated.input": "{0} 个归一化候选，丢弃了 {1} 个。",
    "trace.text.candidate_validated.output.survived": "有 {0} 个候选通过了校验。",
    "trace.text.candidate_validated.output.none_survived": "没有候选通过校验。",
    "trace.text.candidate_grouped.input": "{0} 个已校验候选准备分组。",
    "trace.text.candidate_grouped.output.grouped": "已为通过校验的候选确定存储分组。",
    "trace.text.candidate_grouped.output.none": "没有可分组的已校验候选。",
    "trace.text.candidate_persisted.input": "{0} 个文件候选准备写入。",
    "trace.text.candidate_persisted.output.written": "已写入 {0} 个记忆文件。",
    "trace.text.candidate_persisted.output.none_written": "这一轮没有写入任何项目或反馈文件。",
    "trace.text.user_profile_rewritten.input": "合并了 {0} 个用户候选。",
    "trace.text.user_profile_rewritten.output.stored": "用户画像已写入 {0}。",
    "trace.text.index_error.title": "Index 错误",
    "trace.text.dream_start.input": "{0} Dream 已开始。",
    "trace.text.dream_start.output.evaluated": "Dream 已检查当前是否需要执行。",
    "trace.text.dream_start.output.preparing_snapshot": "正在准备当前已索引的文件记忆快照。",
    "trace.text.snapshot_loaded.input.empty": "加载到的是空的文件记忆快照。",
    "trace.text.snapshot_loaded.output.no_memory": "当前还没有已索引的文件记忆。",
    "trace.text.dream_finished.input.no_memory": "Dream 在没有任何已索引文件记忆的情况下结束。",
    "trace.text.dream_finished.output.no_memory": "当前还没有文件记忆，因此 Dream 没有可整理的内容。",
    "trace.text.snapshot_loaded.input.loaded_files": "已为 Dream 加载 {0} 个当前记忆文件。",
    "trace.text.snapshot_loaded.output.ready_for_planning": "{0} 个项目记忆文件和 {1} 个正式项目已准备好进入 Dream 规划。",
    "trace.text.global_plan_generated.input": "已请求模型审查 {0} 个项目记忆文件，覆盖 {1} 个正式项目。",
    "trace.text.global_plan_generated.output.fallback": "Dream 已生成全局重组计划。",
    "trace.text.global_plan_validated.input": "已根据当前文件记忆校验 Dream 全局计划。",
    "trace.text.global_plan_validated.output": "已校验 {0} 个最终项目、{1} 个待删项目和 {2} 个待删文件。",
    "trace.text.project_rewrite_generated.title": "项目重写 · {0}",
    "trace.text.project_rewrite_generated.input": "正在为 {1} 重写 {0} 个保留文件。",
    "trace.text.project_rewrite_generated.output.fallback": "已为 {0} 准备好重写后的文件。",
    "trace.text.project_mutations_applied.title": "项目变更已应用 · {0}",
    "trace.text.project_mutations_applied.input": "已为 {0} 应用 Dream 的写入和删除。",
    "trace.text.project_mutations_applied.output": "已写入 {0} 个文件，并标记 {1} 个文件待删除。",
    "trace.text.dream_user_profile_rewritten.input.reviewed": "已根据当前文件式用户记忆检查全局用户画像。",
    "trace.text.dream_user_profile_rewritten.input.none": "当前没有可供 Dream 重写的全局用户画像。",
    "trace.text.dream_user_profile_rewritten.output.rewritten": "已重写全局用户画像。",
    "trace.text.dream_user_profile_rewritten.output.unchanged": "全局用户画像不需要 Dream 重写。",
    "trace.text.dream_user_profile_rewritten.output.skipped": "已跳过用户画像重写。",
    "trace.text.manifests_repaired.input": "Dream 写入和删除后，已修复 manifests。",
    "trace.text.manifests_repaired.output": "已为 {0} 个记忆文件重建 manifests。",
    "trace.text.dream_finished.input.completed": "Dream 的整理、重写和清理流程已完成。",
    "trace.text.dream_finished.output.completed_summary": "Dream 检查了 {0} 个记忆文件，重写了 {1} 个项目，删除了 {2} 个项目，删除了 {3} 个文件，未解决 tmp 还剩 {4} 个。",
    "trace.text.dream_finished.input.failed": "Dream 在完成全部阶段前失败了。",
    "trace.text.dream_finished.input.skipped_before_work": "Dream 在真正开始重写工作前就被跳过了。",
    "trace.text.dream_finished.output.scheduled_already_running": "自动 Dream 已跳过，因为另一个 Dream 重建任务正在运行。",
    "trace.text.dream_finished.output.manual_already_running": "手动 Dream 已跳过，因为另一个 Dream 重建任务正在运行。",
    "trace.text.dream_finished.output.no_memory_updates_since_last_dream": "自动 Dream 已跳过：自上次 Dream 以来没有新的记忆文件更新。",
    "trace.tool.summary.started": "{0} 已开始。",
    "trace.tool.summary.blocked": "{0} 被 ClawXMemory 边界拦截。",
    "trace.tool.summary.completed": "{0} 已完成。",
    "trace.tool.summary.failed": "{0} 已失败。",
    "trigger.manual": "手动触发",
    "trigger.explicit_remember": "显式记住",
    "trigger.manual_sync": "手动同步",
    "trigger.scheduled": "自动定时",
  },
  en: {
    "nav.project": "Project",
    "nav.tmp": "Tmp",
    "nav.user": "User",
    "nav.memory_trace": "Trace",
    "nav.lastIndexed": "Last Indexed",
    "nav.waiting": "Waiting",
    "topbar.title": "ClawXMemory",
    "topbar.idle": "Waiting for action",
    "topbar.refresh": "Refresh",
    "topbar.build": "Index Sync",
    "topbar.dream": "Dream",
    "topbar.overview": "Overview",
    "topbar.settings": "Settings",
    "stream.searchPlaceholder": "Search current view",
    "stream.search": "Search",
    "stream.clear": "Clear",
    "stream.items": "{0} items",
    "detail.title": "Record Detail",
    "detail.empty": "Select a memory to inspect",
    "detail.profile": "Profile",
    "detail.preferences": "Preferences",
    "detail.constraints": "Constraints",
    "detail.relationships": "Relationships",
    "detail.notes": "Notes",
    "detail.rule": "Rule",
    "detail.why": "Why",
    "detail.howToApply": "How to apply",
    "detail.currentStage": "Current Stage",
    "detail.decisions": "Decisions",
    "detail.nextSteps": "Next Steps",
    "detail.blockers": "Blockers",
    "detail.timeline": "Timeline",
    "detail.sourceFiles": "Source Files",
    "detail.feedbackRules": "Feedback Rules",
    "detail.projectFiles": "Project Files",
    "detail.feedbackFiles": "Feedback Files",
    "detail.backToProject": "Back to Project",
    "detail.backToList": "Back to Projects",
    "settings.advanced": "Settings",
    "settings.autoIndexInterval": "Auto Index Interval (hours)",
    "settings.autoDreamInterval": "Auto Dream Interval (hours)",
    "settings.scheduleHint": "0 disables the schedule",
    "settings.autoDreamHint": "Auto Dream only runs when memory files changed since the last Dream run.",
    "settings.save": "Save Settings",
    "settings.theme": "Theme",
    "settings.language": "Language",
    "settings.accentColor": "Accent",
    "settings.dataManagement": "Data",
    "settings.export": "Export Snapshot",
    "settings.import": "Import Snapshot",
    "settings.clear": "Clear Memory",
    "settings.theme.light": "Light",
    "settings.theme.dark": "Dark",
    "settings.theme.auto": "Auto",
    "overview.title": "Runtime Overview",
    "overview.group.memory": "Memory Overview",
    "overview.group.recall": "Recent Activity",
    "overview.group.warning": "Warning",
    "overview.formalProjectCount": "Project Memory",
    "overview.tmpTotalFiles": "Unarchived Memory",
    "overview.userProfileCount": "User Portrait",
    "overview.pendingSessions": "Pending Sessions",
    "overview.lastIndexedAt": "Last Indexed",
    "overview.lastDreamAt": "Last Dream",
    "overview.lastDreamStatus": "Dream Status",
    "overview.lastDreamSummary": "Dream Summary",
    "overview.warning.viewDiagnostics": "View Diagnostics",
    "overview.warning.conflictSummary": "Detected {0} workspace boundary conflict(s): {1}",
    "overview.warning.issueSummary": "Runtime warning: {0}",
    "overview.diagnostics.issues": "Issues",
    "overview.diagnostics.conflictingFiles": "Conflicting Files",
    "overview.diagnostics.startupRepairMessage": "Startup Repair Message",
    "confirm.sync.title": "Index Sync",
    "confirm.sync.body": "This scans recent chats and writes classified items into file-based memory.",
    "confirm.sync.ok": "Start Sync",
    "confirm.dream.title": "Dream",
    "confirm.dream.body": "Dream will organize, rewrite, merge, and delete redundant indexed project memory without creating an extra project summary layer.",
    "confirm.dream.ok": "Start Dream",
    "confirm.clear.title": "Clear Memory",
    "confirm.clear.body": "This deletes all stored memory data and cannot be undone. Continue?",
    "confirm.clear.ok": "Clear",
    "confirm.import.title": "Import Snapshot",
    "confirm.import.body": "This fully replaces the current local memory with the imported snapshot bundle. Continue?",
    "confirm.import.ok": "Import",
    "confirm.cancel": "Cancel",
    "confirm.memory.delete.title": "Delete Memory",
    "confirm.memory.delete.body": "This permanently deletes the deprecated memory file and cannot be undone. Continue?",
    "confirm.memory.delete.ok": "Delete",
    "confirm.memory.deprecate.title": "Deprecate Memory",
    "confirm.memory.deprecate.body": "This removes the memory from active recall and default lists, but keeps the file on disk so it can be restored later. Continue?",
    "confirm.memory.deprecate.ok": "Deprecate",
    "confirm.memory.restore.title": "Restore Memory",
    "confirm.memory.restore.body": "This puts the memory back into active lists, counts, and recall. Continue?",
    "confirm.memory.restore.ok": "Restore",
    "prompt.editProjectMeta.title": "Edit Project Meta",
    "prompt.editProjectMeta.body": "This updates project.meta.md without rewriting existing memory bodies. If the project name changes, the old name is appended to aliases.",
    "prompt.editProjectMeta.projectName": "Project name",
    "prompt.editProjectMeta.description": "Description",
    "prompt.editProjectMeta.aliases": "Aliases (one per line)",
    "prompt.editProjectMeta.status": "Status",
    "prompt.editProjectMeta.ok": "Save Project",
    "prompt.editEntry.title.project": "Edit Project Memory",
    "prompt.editEntry.title.feedback": "Edit Feedback Memory",
    "prompt.editEntry.body": "Only structured fields are editable. Raw markdown is not exposed.",
    "prompt.editEntry.name": "Memory name",
    "prompt.editEntry.description": "Description",
    "prompt.editEntry.stage": "Current Stage",
    "prompt.editEntry.decisions": "Decisions (one per line)",
    "prompt.editEntry.constraints": "Constraints (one per line)",
    "prompt.editEntry.nextSteps": "Next Steps (one per line)",
    "prompt.editEntry.blockers": "Blockers (one per line)",
    "prompt.editEntry.timeline": "Timeline (one per line)",
    "prompt.editEntry.notes": "Notes (one per line)",
    "prompt.editEntry.rule": "Rule",
    "prompt.editEntry.why": "Why",
    "prompt.editEntry.howToApply": "How to apply",
    "prompt.editEntry.ok": "Save Memory",
    "prompt.archiveExisting.title": "Archive Into Existing Project",
    "prompt.archiveExisting.body": "Attach this unarchived memory to an existing formal project without running Dream.",
    "prompt.archiveExisting.label": "Target project",
    "prompt.archiveExisting.ok": "Archive",
    "prompt.archiveNew.title": "Archive As New Project",
    "prompt.archiveNew.body": "Promote this unarchived project memory into a new formal project.",
    "prompt.archiveNew.label": "New project name",
    "prompt.archiveNew.placeholder": "Enter a new project name",
    "prompt.archiveNew.ok": "Create and Archive",
    "action.editProjectMeta": "Edit Project Meta",
    "action.editMemory": "Edit Memory",
    "action.viewDetail": "View Detail",
    "action.deleteMemory": "Delete Memory",
    "action.deprecateMemory": "Deprecate Memory",
    "action.restoreMemory": "Restore Memory",
    "action.archiveToProject": "Archive to Existing Project",
    "action.archiveAsProject": "Archive as New Project",
    "action.unavailable": "No available actions",
    "status.refreshing": "Refreshing…",
    "status.refreshed": "Refreshed",
    "status.loading": "Loading…",
    "status.ready": "Ready",
    "status.building": "Syncing…",
    "status.built": "Sync complete · captured sessions {0} / written memories {1} / project {2} / feedback {3} / user {4}",
    "status.dreaming": "Dream organizing…",
    "status.dreamed": "Dream complete · {0}",
    "status.dreamFailed": "Dream failed: {0}",
    "status.clearing": "Clearing…",
    "status.cleared": "Local memory cleared",
    "status.exporting": "Exporting…",
    "status.exported": "Snapshot exported · {0}",
    "status.exportFailed": "Export failed: {0}",
    "status.importing": "Importing…",
    "status.imported": "Snapshot import complete · managed files {0} / memory files {1} / project {2} / feedback {3} / user {4}",
    "status.importInvalid": "The selected file is not a valid memory snapshot bundle",
    "status.importFailed": "Import failed: {0}",
    "status.settingsSaved": "Settings saved",
    "status.searching": "Searching…",
    "status.searched": "Search complete",
    "status.loadFail": "Load failed: {0}",
    "status.memoryActionRunning": "Updating memory…",
    "status.memoryActionDone": "{0}",
    "status.memoryActionFailed": "Memory update failed: {0}",
    "level.project.label": "Project Memory",
    "level.tmp.label": "Tmp Staging",
    "level.user.label": "User Portrait",
    "level.memory_trace.label": "Memory Trace",
    "level.project.empty": "No project memories yet",
    "level.tmp.empty": "No tmp staged memory",
    "level.user.empty": "No user memories yet",
    "level.memory_trace.empty": "No traced conversations yet",
    "board.project": "Project Memory",
    "board.project.unarchived": "Unarchived Memory",
    "board.project.deprecatedProjectFiles": "Deprecated Project Memory",
    "board.project.deprecatedFeedbackFiles": "Deprecated Feedback Memory",
    "board.project.deprecatedTmpFiles": "Deprecated Unarchived Memory",
    "board.tmp": "Tmp Staging",
    "board.tmp.manifest": "_tmp Manifest",
    "board.tmp.projectFiles": "Tmp Project Files",
    "board.tmp.feedbackFiles": "Tmp Feedback Files",
    "board.user": "User Portrait",
    "board.project.unarchived": "Unarchived Memory",
    "board.memoryTrace": "Memory Trace",
    "board.user.empty": "No user portrait is available yet",
    "board.user.sources": "Source Files",
    "board.memoryTrace.empty": "No real traced conversations yet",
    "board.memoryTrace.emptyIndex": "No index trace records yet",
    "board.memoryTrace.emptyDream": "No Dream trace records yet",
    "board.memoryTrace.selectCase": "Select Case",
    "board.memoryTrace.selectIndexTrace": "Select Index Batch",
    "board.memoryTrace.selectDreamTrace": "Select Dream Run",
    "board.memoryTrace.modeRecall": "Recall",
    "board.memoryTrace.modeIndex": "Index",
    "board.memoryTrace.modeDream": "Dream",
    "board.memoryTrace.filterAll": "All Triggers",
    "board.memoryTrace.filterManual": "Manual",
    "board.memoryTrace.filterExplicitRemember": "Explicit Remember",
    "board.memoryTrace.filterManualSync": "Manual Sync",
    "board.memoryTrace.filterScheduled": "Scheduled",
    "board.memoryTrace.query": "Query",
    "board.memoryTrace.session": "Session",
    "board.memoryTrace.mode": "Mode",
    "board.memoryTrace.route": "Route",
    "board.memoryTrace.trigger": "Trigger",
    "board.memoryTrace.status": "Status",
    "board.memoryTrace.kind": "Kind",
    "board.memoryTrace.injected": "Injected",
    "board.memoryTrace.started": "Started",
    "board.memoryTrace.finished": "Finished",
    "board.memoryTrace.context": "Injected Context",
    "board.memoryTrace.tools": "Tool Activity",
    "board.memoryTrace.answer": "Final Answer",
    "board.memoryTrace.flow": "Trace Flow",
    "board.memoryTrace.batchWindow": "Batch Window",
    "board.memoryTrace.snapshot": "Dream Snapshot",
    "board.memoryTrace.mutations": "Applied Mutations",
    "board.memoryTrace.rewrittenProjects": "Rewritten Projects",
    "board.memoryTrace.deletedProjects": "Deleted Projects",
    "board.memoryTrace.deletedFiles": "Deleted Files",
    "board.memoryTrace.snapshotFormalProjects": "Formal Projects",
    "board.memoryTrace.snapshotTmpProjectFiles": "Tmp Project Files",
    "board.memoryTrace.snapshotTmpFeedbackFiles": "Tmp Feedback Files",
    "board.memoryTrace.snapshotFormalProjectFiles": "Formal Project Files",
    "board.memoryTrace.snapshotFormalFeedbackFiles": "Formal Feedback Files",
    "board.memoryTrace.snapshotHasUserProfile": "Has User Profile",
    "board.memoryTrace.storedResults": "Stored Results",
    "board.memoryTrace.focusTurns": "Focus User Turns",
    "board.memoryTrace.indexSelectorMeta": "{0} · {1} seg · {2} stored",
    "board.memoryTrace.dreamSelectorMeta": "{0} formal · {1} rewritten · {2} files deleted",
    "board.memoryTrace.noTrace": "This case does not contain a retrieval trace.",
    "board.memoryTrace.noStep": "This step does not contain structured details.",
    "board.memoryTrace.noPromptDebug": "This step has no model prompt debug data, usually because it is a local code decision.",
    "board.memoryTrace.promptHint": "Prompt debug is available below.",
    "board.project.feedbackCount": "{0} feedback",
    "board.project.memoryCount": "{0} project memories",
    "board.memoryTrace.promptDebug": "Prompt Debug",
    "board.memoryTrace.systemPrompt": "System Prompt",
    "board.memoryTrace.userPrompt": "User Prompt",
    "board.memoryTrace.rawOutput": "Raw Output",
    "board.memoryTrace.parsedResult": "Parsed Result",
    "meta.type": "Type",
    "meta.scope": "Scope",
    "meta.projectId": "Project",
    "meta.updatedAt": "Updated",
    "meta.capturedAt": "Captured",
    "meta.sessionKey": "Session",
    "meta.dreamAttempts": "Dream Attempts",
    "meta.path": "Path",
    "meta.file": "File",
    "meta.counts": "Counts",
    "meta.global": "Global",
    "meta.project": "Project",
    "common.none": "None",
    "common.unknown": "Unknown",
    "common.yes": "Yes",
    "common.no": "No",
    "type.user": "User",
    "type.feedback": "Feedback",
    "type.project": "Project",
    "scope.global": "Global",
    "scope.project": "Project",
    "recall.llm": "LLM Selection",
    "recall.none": "None",
    "path.auto": "Auto",
    "path.explicit": "Explicit",
    "dream.status.never": "Never",
    "dream.status.running": "Running",
    "dream.status.success": "Success",
    "dream.status.skipped": "Skipped",
    "dream.status.failed": "Failed",
    "startup.idle": "Idle",
    "startup.running": "Running",
    "startup.failed": "Failed",
    "runtime.healthy": "Healthy",
    "runtime.unhealthy": "Issues",
    "boundary.ready": "Ready",
    "boundary.isolated": "Isolated",
    "boundary.conflict": "Conflict",
    "boundary.warning": "Warning",
    "route.none": "None",
    "route.user": "User",
    "route.project_memory": "Project Memory",
    "project.active": "In Progress",
    "project.planned": "Planned",
    "project.in_progress": "In Progress",
    "project.done": "Done",
    "trace.step.recall_start": "Recall Start",
    "trace.step.memory_gate": "Memory Gate",
    "trace.step.user_base_loaded": "User Base Loaded",
    "trace.step.project_shortlist_built": "Project Shortlist Built",
    "trace.step.project_selected": "Project Selected",
    "trace.step.manifest_scanned": "Manifest Scanned",
    "trace.step.manifest_selected": "Manifest Selected",
    "trace.step.files_loaded": "Files Loaded",
    "trace.step.context_rendered": "Context Rendered",
    "trace.step.recall_skipped": "Recall Skipped",
    "trace.step.cache_hit": "Cache Hit",
    "trace.step.index_start": "Index Start",
    "trace.step.batch_loaded": "Batch Loaded",
    "trace.step.focus_turns_selected": "Focus Turns Selected",
    "trace.step.turn_classified": "Turn Classified",
    "trace.step.candidate_validated": "Candidate Validated",
    "trace.step.candidate_grouped": "Candidate Grouped",
    "trace.step.candidate_persisted": "Candidate Persisted",
    "trace.step.user_profile_rewritten": "User Profile Rewritten",
    "trace.step.index_finished": "Index Finished",
    "trace.step.dream_start": "Dream Start",
    "trace.step.snapshot_loaded": "Snapshot Loaded",
    "trace.step.global_plan_generated": "Global Plan Generated",
    "trace.step.global_plan_validated": "Global Plan Validated",
    "trace.step.project_rewrite_generated": "Project Rewrite Generated",
    "trace.step.project_mutations_applied": "Project Mutations Applied",
    "trace.step.manifests_repaired": "Manifests Repaired",
    "trace.step.dream_finished": "Dream Finished",
    "trace.step.unknown": "Trace Step",
    "trace.detail.recall_inputs": "Recall Inputs",
    "trace.detail.recent_user_messages": "Recent User Messages",
    "trace.detail.route": "Route",
    "trace.detail.user_profile": "User Profile",
    "trace.detail.source_files": "Source Files",
    "trace.detail.project_shortlist": "Project Shortlist",
    "trace.detail.recent_user_texts": "Recent User Texts",
    "trace.detail.shortlist_candidates": "Shortlist Candidates",
    "trace.detail.project_selection": "Project Selection",
    "trace.detail.manifest_scan": "Manifest Scan",
    "trace.detail.sorted_candidates": "Sorted Candidates",
    "trace.detail.manifest_candidate_ids": "Manifest Candidate IDs",
    "trace.detail.selected_file_ids": "Selected File IDs",
    "trace.detail.selection_summary": "Selection Summary",
    "trace.detail.requested_ids": "Requested IDs",
    "trace.detail.loaded_files": "Loaded Files",
    "trace.detail.truncated_files": "Truncated Files",
    "trace.detail.missing_ids": "Missing IDs",
    "trace.detail.context_summary": "Context Summary",
    "trace.detail.injected_blocks": "Injected Blocks",
    "trace.detail.recall_query": "Recall Query",
    "trace.detail.skip_reason": "Skip Reason",
    "trace.detail.batch_summary": "Batch Summary",
    "trace.detail.batch_context": "Batch Context",
    "trace.detail.focus_selection_summary": "Focus Selection Summary",
    "trace.detail.focus_turn": "Focus Turn {0}",
    "trace.detail.focus_user_turn": "Focus User Turn",
    "trace.detail.classification_result": "Classification Result",
    "trace.detail.classifier_candidates": "Classifier Candidates",
    "trace.detail.discarded_reasons": "Discarded Reasons",
    "trace.detail.raw_candidates": "Raw Candidates",
    "trace.detail.normalized_candidates": "Normalized Candidates",
    "trace.detail.discarded_candidates": "Discarded Candidates",
    "trace.detail.grouping_result": "Grouping Result",
    "trace.detail.persisted_files": "Persisted Files",
    "trace.detail.index_error": "Index Error",
    "trace.detail.user_profile_result": "User Profile Result",
    "trace.detail.user_rewrite_error": "User Rewrite Error",
    "trace.detail.run_trigger": "Run Trigger",
    "trace.detail.dream_snapshot": "Dream Snapshot",
    "trace.detail.project_memory_snapshot": "Project Memory Snapshot",
    "trace.detail.final_project_plan": "Final Project Plan",
    "trace.detail.deleted_formal_projects": "Deleted Formal Projects",
    "trace.detail.deleted_memory_files": "Deleted Memory Files",
    "trace.detail.project_meta_before_after": "Project Meta Before/After",
    "trace.detail.retained_source_files": "Retained Source Files",
    "trace.detail.rewritten_files": "Rewritten Files",
    "trace.detail.deleted_source_files": "Deleted Source Files",
    "trace.detail.written_files": "Written Files",
    "trace.detail.deleted_file_previews": "Deleted File Previews",
    "trace.detail.user_profile_before": "User Profile Before",
    "trace.detail.user_profile_after": "User Profile After",
    "trace.detail.stored_results": "Stored Results",
    "trace.text.recall_start.output.runtime_inspected": "Runtime inspected this turn before attempting retrieval.",
    "trace.text.recall_skipped.output.memory_write_turn": "Automatic recall did not run because this turn is a memory write request.",
    "trace.text.recall_skipped.output.reason": "Automatic recall did not run because {0}.",
    "trace.text.recall_skipped.output.interrupted_by_new_turn": "A newer user turn interrupted this case before completion.",
    "trace.text.recall_skipped.title.interrupted": "Recall Interrupted",
    "trace.text.user_base_loaded.input.global_user_profile": "global user profile",
    "trace.text.user_base_loaded.output.attached": "Attached compact global user profile.",
    "trace.text.user_base_loaded.output.missing": "No compact global user profile is available yet.",
    "trace.text.project_shortlist_built.input": "{0} formal projects",
    "trace.text.project_shortlist_built.output": "{0} shortlist candidates ready.",
    "trace.text.project_selected.input": "{0} shortlist candidates",
    "trace.text.project_selected.output.none_selected": "No formal project was selected for this query.",
    "trace.text.project_selected.output.not_required": "This recall route does not require project selection.",
    "trace.text.manifest_scanned.output.ready": "{0} recall header entries ready.",
    "trace.text.manifest_scanned.output.with_limit": "{0} recall header entries ready (top {1} of {2}).",
    "trace.text.manifest_scanned.output.no_project_selected": "Project recall skipped because no formal project was selected.",
    "trace.text.manifest_scanned.output.not_required": "This recall route does not require a project manifest.",
    "trace.text.manifest_selected.input": "{0} entries",
    "trace.text.manifest_selected.output": "{0} file ids selected.",
    "trace.text.files_loaded.input": "{0} requested",
    "trace.text.files_loaded.output": "{0} files loaded.",
    "trace.text.context_rendered.input.with_user_base": "{0} files + user base",
    "trace.text.context_rendered.input.no_user_base": "{0} files + no user base",
    "trace.text.context_rendered.output.prepared": "Memory context prepared.",
    "trace.text.context_rendered.no_memory_context": "No memory context injected.",
    "trace.text.recall_skipped.query_does_not_need_memory": "This query does not need long-term memory.",
    "trace.text.index_start.output.preparing_batch": "Preparing batch indexing for {0}.",
    "trace.text.batch_loaded.input": "{0} segments from {1} to {2}",
    "trace.text.batch_loaded.output": "{0} messages loaded into batch context.",
    "trace.text.focus_turns_selected.input": "{0} user turns in this batch.",
    "trace.text.focus_turns_selected.output.classifying": "User turns will be classified one by one.",
    "trace.text.focus_turns_selected.output.no_user_turns": "No user turns found; this batch will be marked indexed without storing memory.",
    "trace.text.candidate_validated.input": "{0} normalized candidates, {1} discarded.",
    "trace.text.candidate_validated.output.survived": "{0} candidates survived validation.",
    "trace.text.candidate_validated.output.none_survived": "No candidates survived validation.",
    "trace.text.candidate_grouped.input": "{0} validated candidates ready for grouping.",
    "trace.text.candidate_grouped.output.grouped": "Resolved storage groups for validated candidates.",
    "trace.text.candidate_grouped.output.none": "No validated candidates to group.",
    "trace.text.candidate_persisted.input": "{0} file candidates ready to persist.",
    "trace.text.candidate_persisted.output.written": "{0} memory files written.",
    "trace.text.candidate_persisted.output.none_written": "No project or feedback files were written for this turn.",
    "trace.text.user_profile_rewritten.input": "{0} user candidates merged.",
    "trace.text.user_profile_rewritten.output.stored": "Stored user profile at {0}.",
    "trace.text.index_error.title": "Index Error",
    "trace.text.dream_start.input": "{0} Dream run started.",
    "trace.text.dream_start.output.evaluated": "Dream evaluated whether it should run.",
    "trace.text.dream_start.output.preparing_snapshot": "Preparing current indexed file-memory snapshot.",
    "trace.text.snapshot_loaded.input.empty": "Loaded an empty file-memory snapshot.",
    "trace.text.snapshot_loaded.output.no_memory": "No indexed file-memory exists yet.",
    "trace.text.dream_finished.input.no_memory": "Finished Dream without any indexed file-memory.",
    "trace.text.dream_finished.output.no_memory": "No file-based memory exists yet, so Dream had nothing to organize.",
    "trace.text.snapshot_loaded.input.loaded_files": "Loaded {0} current memory files for Dream.",
    "trace.text.snapshot_loaded.output.ready_for_planning": "{0} project memory files and {1} formal projects are ready for Dream planning.",
    "trace.text.global_plan_generated.input": "Asked the model to audit {0} project memory files across {1} formal projects.",
    "trace.text.global_plan_generated.output.fallback": "Dream generated a global reorganization plan.",
    "trace.text.global_plan_validated.input": "Validated the global Dream plan against current file-memory.",
    "trace.text.global_plan_validated.output": "Validated {0} final projects, {1} deleted projects, and {2} deleted files.",
    "trace.text.project_rewrite_generated.title": "Project Rewrite · {0}",
    "trace.text.project_rewrite_generated.input": "For {1}, rewriting {0} retained files.",
    "trace.text.project_rewrite_generated.output.fallback": "Prepared rewritten files for {0}.",
    "trace.text.project_mutations_applied.title": "Project Mutations Applied · {0}",
    "trace.text.project_mutations_applied.input": "Applied Dream writes and deletions for {0}.",
    "trace.text.project_mutations_applied.output": "Wrote {0} files and marked {1} files for deletion.",
    "trace.text.dream_user_profile_rewritten.input.reviewed": "Reviewed the global user profile against current file-based user memory.",
    "trace.text.dream_user_profile_rewritten.input.none": "No global user profile was available for Dream rewrite.",
    "trace.text.dream_user_profile_rewritten.output.rewritten": "Rewrote the global user profile.",
    "trace.text.dream_user_profile_rewritten.output.unchanged": "Global user profile did not need a Dream rewrite.",
    "trace.text.dream_user_profile_rewritten.output.skipped": "Skipped user profile rewrite.",
    "trace.text.manifests_repaired.input": "Repaired manifests after Dream writes and deletions.",
    "trace.text.manifests_repaired.output": "Rebuilt manifests for {0} memory files.",
    "trace.text.dream_finished.input.completed": "Completed Dream organization, rewriting, and cleanup.",
    "trace.text.dream_finished.output.completed_summary": "Dream reviewed {0} memory files, rewrote {1} projects, deleted {2} projects, deleted {3} files, unresolved tmp={4}.",
    "trace.text.dream_finished.input.failed": "Dream failed before it could finish all stages.",
    "trace.text.dream_finished.input.skipped_before_work": "Dream was skipped before any rewrite work started.",
    "trace.text.dream_finished.output.scheduled_already_running": "Skipped automatic Dream because another Dream reconstruction is already running.",
    "trace.text.dream_finished.output.manual_already_running": "Skipped manual Dream because another Dream reconstruction is already running.",
    "trace.text.dream_finished.output.no_memory_updates_since_last_dream": "Skipped automatic Dream: no memory file updates since the last Dream run.",
    "trace.tool.summary.started": "{0} started.",
    "trace.tool.summary.blocked": "{0} blocked by ClawXMemory boundary.",
    "trace.tool.summary.completed": "{0} completed.",
    "trace.tool.summary.failed": "{0} failed.",
    "trigger.manual": "Manual",
    "trigger.explicit_remember": "Explicit Remember",
    "trigger.manual_sync": "Manual Sync",
    "trigger.scheduled": "Scheduled",
  },
};

/* ── constants & state ─────────────────────────────────── */

const STORAGE = {
  theme: "clawxmemory.ui.theme",
  accent: "clawxmemory.ui.accent",
  locale: "clawxmemory.ui.locale",
};

const LEVELS = ["project", "user", "memory_trace"];
const DEFAULT_SETTINGS = {
  reasoningMode: "answer_first",
  autoIndexIntervalMinutes: 60,
  autoDreamIntervalMinutes: 360,
};

const root = document.documentElement;
const body = document.body;
const appShell = document.querySelector(".app-shell");
const appScrim = document.getElementById("appScrim");

const boardNavTabs = document.getElementById("boardNavTabs");
const navMenuTrigger = document.getElementById("navMenuTrigger");
const settingsPopover = document.getElementById("settingsPopover");
const advancedSettingsToggle = document.getElementById("advancedSettingsToggle");
const advancedSettingsBody = document.getElementById("advancedSettingsBody");
const dataManagementToggle = document.getElementById("dataManagementToggle");
const dataManagementBody = document.getElementById("dataManagementBody");
const overviewToggleBtn = document.getElementById("overviewToggleBtn");
const overviewPanel = document.getElementById("overviewPanel");
const overviewCloseBtn = document.getElementById("overviewCloseBtn");
const overviewCards = document.getElementById("overviewCards");
const refreshBtn = document.getElementById("refreshBtn");
const buildNowBtn = document.getElementById("buildNowBtn");
const dreamRunBtn = document.getElementById("dreamRunBtn");
const navLastIndexed = document.getElementById("navLastIndexed");
const activityText = document.getElementById("activityText");
const browserTitle = document.getElementById("browserTitle");
const browserMeta = document.getElementById("browserMeta");
const listQueryInput = document.getElementById("listQueryInput");
const listSearchBtn = document.getElementById("listSearchBtn");
const listClearBtn = document.getElementById("listClearBtn");
const projectListBoard = document.getElementById("projectListBoard");
const projectDetailBoard = document.getElementById("projectDetailBoard");
const projectDetailBackBtn = document.getElementById("projectDetailBackBtn");
const projectDetailTitle = document.getElementById("projectDetailTitle");
const projectDetailSubtitle = document.getElementById("projectDetailSubtitle");
const projectDetailHeadActions = document.getElementById("projectDetailHeadActions");
const projectDetailMeta = document.getElementById("projectDetailMeta");
const projectDetailBody = document.getElementById("projectDetailBody");
const fileDetailBoard = document.getElementById("fileDetailBoard");
const fileDetailBackBtn = document.getElementById("fileDetailBackBtn");
const fileDetailTitle = document.getElementById("fileDetailTitle");
const fileDetailSubtitle = document.getElementById("fileDetailSubtitle");
const fileDetailMeta = document.getElementById("fileDetailMeta");
const fileDetailBody = document.getElementById("fileDetailBody");
const tmpBoard = document.getElementById("tmpBoard");
const userBoard = document.getElementById("userBoard");
const memoryTraceBoard = document.getElementById("memoryTraceBoard");
const listSearchRow = document.getElementById("listSearchRow");
const autoIndexIntervalHoursInput = document.getElementById("autoIndexIntervalHoursInput");
const autoDreamIntervalHoursInput = document.getElementById("autoDreamIntervalHoursInput");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const themeToggle = document.getElementById("themeToggle");
const langToggle = document.getElementById("langToggle");
const accentPicker = document.getElementById("accentPicker");
const exportMemoryBtn = document.getElementById("exportMemoryBtn");
const importMemoryBtn = document.getElementById("importMemoryBtn");
const clearMemoryBtn = document.getElementById("clearMemoryBtn");
const importMemoryInput = document.getElementById("importMemoryInput");
const navToggleBtn = document.getElementById("navToggleBtn");
const navCloseBtn = document.getElementById("navCloseBtn");
const modalOverlay = document.getElementById("modalOverlay");
const modalCard = document.getElementById("modalCard");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalFields = document.getElementById("modalFields");
const modalConfirm = document.getElementById("modalConfirm");
const modalCancel = document.getElementById("modalCancel");

const state = {
  locale: localStorage.getItem(STORAGE.locale) || "zh",
  theme: localStorage.getItem(STORAGE.theme) || "light",
  accent: localStorage.getItem(STORAGE.accent) || "blue",
  mainView: "project-list",
  overview: {},
  settings: { ...DEFAULT_SETTINGS },
  queries: {
    project_list: "",
    project_detail: "",
    tmp: "",
    memory_trace: "",
  },
  projectGroups: [],
  projectGroupsLoaded: false,
  tmpSnapshot: null,
  tmpLoaded: false,
  userSummary: null,
  userSummaryLoaded: false,
  recordCache: new Map(),
  cases: [],
  caseRequestLoaded: false,
  caseDetailCache: new Map(),
  selectedCaseId: "",
  activeTraceStepId: "",
  indexTraces: [],
  indexTraceRequestLoaded: false,
  indexTraceDetailCache: new Map(),
  selectedIndexTraceId: "",
  activeIndexTraceStepId: "",
  dreamTraces: [],
  dreamTraceRequestLoaded: false,
  dreamTraceDetailCache: new Map(),
  selectedDreamTraceId: "",
  activeDreamTraceStepId: "",
  traceMode: "recall",
  indexTraceFilterTrigger: "all",
  dreamTraceFilterTrigger: "all",
  selectedProjectId: "",
  selectedFileId: "",
  selectedFileType: "",
  fileReturnView: "project-list",
  settingsPopoverOpen: false,
  traceSelectorOpen: false,
  modalResolver: null,
  modalSubmitHandler: null,
};

/* ── utils ─────────────────────────────────────────────── */

function t(key, ...args) {
  const dict = LOCALES[state.locale] || LOCALES.zh;
  const fallback = LOCALES.en[key] || LOCALES.zh[key] || key;
  return String(dict[key] ?? fallback).replace(/\{(\d+)\}/g, (_, index) => {
    const value = args[Number(index)];
    return value == null ? "" : String(value);
  });
}

function setActivity(message, ...args) {
  if (!activityText) return;
  activityText.textContent = LOCALES[state.locale][message] || LOCALES.en[message]
    ? t(message, ...args)
    : String(message);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clearNode(node) {
  if (node) node.replaceChildren();
  return node;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "").trim();
}

function renderTraceText(rawValue, descriptor) {
  const rendered = renderTraceI18nText(rawValue, descriptor, state.locale, LOCALES);
  return normalizeText(rendered) || normalizeText(rawValue);
}

function renderTraceLabel(detail) {
  return renderTraceText(detail?.label, detail?.labelI18n);
}

function renderTraceSummary(rawValue, descriptor, fallback = t("common.none")) {
  return renderTraceText(rawValue, descriptor) || fallback;
}

function formatTraceRawValue(value) {
  const normalized = normalizeText(value);
  return normalized || t("common.none");
}

function escapeQueryValue(value) {
  return encodeURIComponent(String(value || ""));
}

function decodeEscapedTraceText(value) {
  const raw = String(value ?? "");
  if (!raw.includes("\\")) return raw;
  const hasEscapes = /\\u[0-9a-fA-F]{4}|\\[nrt"\\]/.test(raw);
  if (!hasEscapes) return raw;
  return raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function decodeEscapedTraceValue(value) {
  if (typeof value === "string") return decodeEscapedTraceText(value);
  if (Array.isArray(value)) return value.map((item) => decodeEscapedTraceValue(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decodeEscapedTraceValue(item)]),
  );
}

function safeJson(value) {
  try {
    return JSON.stringify(decodeEscapedTraceValue(value), null, 2);
  } catch {
    return decodeEscapedTraceText(String(value));
  }
}

function formatNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat(state.locale === "zh" ? "zh-CN" : "en-US").format(value);
}

function formatDateTime(value) {
  const raw = normalizeText(value);
  if (!raw) return t("common.none");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat(state.locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readListFromSection(lines) {
  return safeArray(lines)
    .map((line) => normalizeText(line).replace(/^- /, ""))
    .filter(Boolean);
}

function readTextFromSection(lines) {
  return safeArray(lines).map((line) => String(line)).join("\n").trim();
}

function parseSections(content) {
  const sections = new Map();
  let current = "";
  String(content || "").split("\n").forEach((line) => {
    const match = /^##\s+(.+?)\s*$/.exec(line.trim());
    if (match) {
      current = match[1];
      sections.set(current, []);
      return;
    }
    const bucket = sections.get(current) || [];
    bucket.push(line);
    sections.set(current, bucket);
  });
  return sections;
}

function formatDreamStatus(value) {
  if (!value) return t("dream.status.never");
  const key = `dream.status.${value}`;
  return LOCALES[state.locale][key] || LOCALES.en[key] ? t(key) : String(value);
}

function formatRecallRoute(value) {
  if (!value) return t("common.none");
  const key = `route.${value}`;
  return LOCALES[state.locale][key] || LOCALES.en[key] ? t(key) : String(value);
}

function joinLocalizedList(items) {
  const cleaned = safeArray(items).map((item) => normalizeText(item)).filter(Boolean);
  if (!cleaned.length) return t("common.none");
  return state.locale === "zh" ? cleaned.join("、") : cleaned.join(", ");
}

function buildDashboardWarningText(overview) {
  const diagnostics = overview?.dashboardDiagnostics || null;
  const conflictingFiles = safeArray(diagnostics?.conflictingFiles)
    .map((file) => normalizeText(file?.name))
    .filter(Boolean);
  if (conflictingFiles.length) {
    return t(
      "overview.warning.conflictSummary",
      String(conflictingFiles.length),
      joinLocalizedList(conflictingFiles),
    );
  }
  const issues = safeArray(diagnostics?.issues).map((issue) => normalizeText(issue)).filter(Boolean);
  if (issues.length) return t("overview.warning.issueSummary", issues[0]);
  const startupRepairMessage = normalizeText(diagnostics?.startupRepairMessage);
  if (startupRepairMessage) return t("overview.warning.issueSummary", startupRepairMessage);
  return normalizeText(overview?.dashboardWarning) || t("common.none");
}

function inferProjectStatus(entry, record) {
  const haystack = [
    entry?.description,
    record?.content,
  ].join(" ").toLowerCase();
  if (/(done|completed|已完成|上线|发布完成|closed)/.test(haystack)) return "done";
  if (/(planned|plan|待开始|计划中|todo|backlog)/.test(haystack)) return "planned";
  return "in_progress";
}

function normalizeProjectStatusValue(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "in_progress";
  if (normalized === "done" || normalized === "completed") return "done";
  if (normalized === "planned" || normalized === "plan") return "planned";
  if (normalized === "active" || normalized === "in_progress" || normalized === "progress" || normalized === "ongoing") {
    return "in_progress";
  }
  return normalized;
}

function getPrimaryProjectEntry(group) {
  return safeArray(group?.projectEntries)[0] || null;
}

function inferProjectGroupStatus(group) {
  const normalized = normalizeProjectStatusValue(group?.status);
  if (normalized === "done" || normalized === "planned" || normalized === "in_progress") {
    return normalized;
  }
  return inferProjectStatus(getPrimaryProjectEntry(group));
}

function getVisibleProjectGroups() {
  const query = normalizeText(state.queries.project_list).toLowerCase();
  const groups = state.projectGroups;
  if (!query) return groups;
  return groups.filter((group) => {
    const haystack = [
      group.projectName,
      group.description,
      ...safeArray(group.aliases),
      ...safeArray(group.projectEntries).flatMap((entry) => [entry.name, entry.description]),
      ...safeArray(group.feedbackEntries).flatMap((entry) => [entry.name, entry.description]),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function getCurrentLevel() {
  if (state.mainView === "file-detail" && state.fileReturnView === "tmp") return "tmp";
  if (state.mainView === "file-detail" && state.fileReturnView === "user") return "user";
  if (state.mainView === "tmp") return "tmp";
  if (state.mainView === "user") return "user";
  if (state.mainView === "memory_trace") return "memory_trace";
  return "project";
}

function getNavPage() {
  if (state.mainView === "file-detail" && state.fileReturnView === "tmp") return "tmp";
  if (state.mainView === "file-detail" && state.fileReturnView === "user") return "user";
  if (state.mainView === "tmp") return "tmp";
  if (state.mainView === "user") return "user";
  if (state.mainView === "memory_trace") return "memory_trace";
  return "project";
}

function getCurrentSearchKey() {
  if (state.mainView === "project-list") return "project_list";
  if (state.mainView === "project-detail") return "project_detail";
  if (state.mainView === "tmp") return "tmp";
  if (state.mainView === "memory_trace") return "memory_trace";
  return "";
}

function getMemoryCount(level) {
  if (level === "project") {
    const formalProjects = Number(state.overview.formalProjectCount || state.projectGroups.length || 0);
    const tmpFiles = Number(state.overview.tmpTotalFiles || state.tmpSnapshot?.totalFiles || 0);
    return formalProjects + tmpFiles;
  }
  if (level === "tmp") return Number(state.overview.tmpTotalFiles || state.tmpSnapshot?.totalFiles || 0);
  if (level === "user") {
    return Number(state.overview.userProfileCount || (safeArray(state.userSummary?.files).length > 0 ? 1 : 0));
  }
  if (level === "memory_trace") {
    if (state.traceMode === "index") {
      return state.indexTraces.length || Number(state.overview.recentIndexTraceCount || 0);
    }
    if (state.traceMode === "dream") {
      return state.dreamTraces.length || Number(state.overview.recentDreamTraceCount || 0);
    }
    return state.cases.length || Number(state.overview.recentRecallTraceCount || 0);
  }
  return 0;
}

function getViewElement(view) {
  if (view === "project-list") return projectListBoard;
  if (view === "project-detail") return projectDetailBoard;
  if (view === "file-detail") return fileDetailBoard;
  if (view === "tmp") return tmpBoard;
  if (view === "user") return userBoard;
  return memoryTraceBoard;
}

function isValidLevel(value) {
  return LEVELS.includes(value);
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (!key) return;
    const attr = node.getAttribute("data-i18n-attr");
    if (attr) {
      node.setAttribute(attr, t(key));
      return;
    }
    node.textContent = t(key);
  });
}

/* ── theme, locale, layout state ──────────────────────── */

function applyTheme() {
  const theme = state.theme === "auto"
    ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : state.theme;
  root.dataset.theme = theme;
  root.dataset.accent = state.accent;
  root.lang = state.locale === "zh" ? "zh-CN" : "en";

  if (themeToggle) {
    themeToggle.querySelectorAll("[data-theme-value]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-theme-value") === state.theme);
      btn.setAttribute("title", t(`settings.theme.${btn.getAttribute("data-theme-value")}`));
    });
  }

  if (langToggle) {
    langToggle.querySelectorAll("[data-locale]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-locale") === state.locale);
    });
  }

  if (accentPicker) {
    accentPicker.querySelectorAll("[data-accent]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-accent") === state.accent);
    });
  }
}

function persistUiPrefs() {
  localStorage.setItem(STORAGE.theme, state.theme);
  localStorage.setItem(STORAGE.accent, state.accent);
  localStorage.setItem(STORAGE.locale, state.locale);
}

function updatePanels(panel = "") {
  if (panel) body.dataset.panel = panel;
  else delete body.dataset.panel;
}

function openPanel(panel) {
  updatePanels(panel);
}

function closePanels() {
  updatePanels("");
}

function openNav() {
  body.dataset.nav = "open";
}

function closeNav() {
  delete body.dataset.nav;
}

function toggleSection(toggleEl, bodyEl, open) {
  if (!toggleEl || !bodyEl) return;
  toggleEl.classList.toggle("open", open);
  bodyEl.classList.toggle("open", open);
}

function positionSettingsPopover() {
  if (!settingsPopover || !navMenuTrigger) return;
  const rect = navMenuTrigger.getBoundingClientRect();
  settingsPopover.style.left = `${Math.max(12, rect.left)}px`;
  settingsPopover.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 8)}px`;
}

function setSettingsPopover(open) {
  state.settingsPopoverOpen = open;
  if (!settingsPopover) return;
  settingsPopover.classList.toggle("open", open);
  if (open) positionSettingsPopover();
}

/* ── modal ─────────────────────────────────────────────── */

function confirmAction({ title, body: description, confirmLabel }) {
  if (!modalOverlay || !modalTitle || !modalBody || !modalConfirm || !modalCancel || !modalFields) {
    return Promise.resolve(window.confirm(`${title}\n\n${description}`));
  }
  modalTitle.textContent = title;
  modalBody.textContent = description;
  clearNode(modalFields);
  modalConfirm.textContent = confirmLabel;
  modalConfirm.classList.remove("danger");
  modalCancel.textContent = t("confirm.cancel");
  modalOverlay.classList.remove("form-mode");
  modalCard?.classList.remove("form-mode");
  modalOverlay.classList.add("open");
  return new Promise((resolve) => {
    state.modalResolver = resolve;
    state.modalSubmitHandler = () => closeModal(true);
  });
}

function closeModal(result) {
  if (modalOverlay) modalOverlay.classList.remove("open");
  if (modalOverlay) modalOverlay.classList.remove("form-mode");
  modalCard?.classList.remove("form-mode");
  if (modalFields) clearNode(modalFields);
  if (modalConfirm) modalConfirm.classList.remove("danger");
  const resolver = state.modalResolver;
  state.modalResolver = null;
  state.modalSubmitHandler = null;
  if (resolver) resolver(result);
}

function requestActionForm({
  title,
  body: description,
  confirmLabel,
  danger = false,
  fields = [],
}) {
  if (!modalOverlay || !modalTitle || !modalBody || !modalConfirm || !modalCancel || !modalFields) {
    const fallbackValue = window.prompt(description);
    if (fallbackValue == null) return Promise.resolve(null);
    if (!fields.length) return Promise.resolve({ value: fallbackValue });
    return Promise.resolve({ [fields[0].id]: fallbackValue });
  }
  modalTitle.textContent = title;
  modalBody.textContent = description;
  clearNode(modalFields);
  modalOverlay.classList.add("form-mode");
  modalCard?.classList.add("form-mode");
  fields.forEach((field) => {
    const wrapper = el("label", "modal-field");
    wrapper.dataset.span = field.span || "full";
    wrapper.append(el("span", "modal-field-label", field.label));
    if (field.kind === "select") {
      const select = document.createElement("select");
      select.className = "modal-field-control";
      select.dataset.modalField = field.id;
      select.dataset.required = field.required === false ? "false" : "true";
      safeArray(field.options).forEach((option) => {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        if (field.value === option.value) node.selected = true;
        select.append(node);
      });
      wrapper.append(select);
    } else if (field.kind === "textarea") {
      const textarea = document.createElement("textarea");
      textarea.className = "modal-field-control";
      textarea.dataset.modalField = field.id;
      textarea.dataset.required = field.required === false ? "false" : "true";
      textarea.value = field.value || "";
      textarea.rows = Number(field.rows || 4);
      if (field.placeholder) textarea.placeholder = field.placeholder;
      wrapper.append(textarea);
    } else {
      const input = document.createElement("input");
      input.className = "modal-field-control";
      input.dataset.modalField = field.id;
      input.dataset.required = field.required === false ? "false" : "true";
      input.type = "text";
      input.value = field.value || "";
      if (field.placeholder) input.placeholder = field.placeholder;
      wrapper.append(input);
    }
    modalFields.append(wrapper);
  });
  modalConfirm.textContent = confirmLabel;
  modalConfirm.classList.toggle("danger", Boolean(danger));
  modalCancel.textContent = t("confirm.cancel");
  modalOverlay.classList.add("open");
  return new Promise((resolve) => {
    state.modalResolver = resolve;
    state.modalSubmitHandler = () => {
      const payload = {};
      const controls = modalFields.querySelectorAll("[data-modal-field]");
      for (const control of controls) {
        const id = control.dataset.modalField;
        if (!id) continue;
        const rawValue = typeof control.value === "string" ? control.value : "";
        const value = control.tagName === "TEXTAREA" ? rawValue.trimEnd() : normalizeText(rawValue);
        const required = control.dataset.required !== "false";
        if (required && !normalizeText(value)) {
          control.focus();
          return;
        }
        payload[id] = value;
      }
      closeModal(payload);
    };
    const firstControl = modalFields.querySelector("[data-modal-field]");
    if (modalFields) modalFields.scrollTop = 0;
    if (firstControl) setTimeout(() => firstControl.focus(), 0);
  });
}

/* ── api ───────────────────────────────────────────────── */

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

async function postJson(url, body = undefined) {
  const response = await fetch(url, {
    method: "POST",
    headers: body == null ? {} : { "content-type": "application/json" },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

function getFormalProjectChoices() {
  return safeArray(state.projectGroups)
    .map((group) => ({
      value: group.projectId,
      label: `${group.projectName} · ${group.projectId}`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function splitMultilineItems(value) {
  return String(value || "")
    .split("\n")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function joinMultilineItems(items) {
  return safeArray(items).map((item) => normalizeText(item)).filter(Boolean).join("\n");
}

function getProjectStatusOptions(current) {
  const values = ["planned", "in_progress", "done"];
  const currentValue = normalizeProjectStatusValue(current);
  if (currentValue && !values.includes(currentValue)) values.unshift(currentValue);
  return values.map((value) => ({
    value,
    label: t(`project.${value}`) !== `project.${value}` ? t(`project.${value}`) : value,
  }));
}

async function refreshAfterMemoryMutation({ view = state.mainView, projectId = state.selectedProjectId } = {}) {
  invalidateMemoryCaches();
  await loadSnapshot({ silent: true });
  await ensureActiveData({ force: true });
  state.selectedFileId = "";
  state.selectedFileType = "";
  if (view === "project-detail" && projectId && safeArray(state.projectGroups).some((item) => item.projectId === projectId)) {
    state.selectedProjectId = projectId;
    state.mainView = "project-detail";
  } else if (view === "user") {
    state.mainView = "user";
  } else if (view === "tmp") {
    state.mainView = "project-list";
    state.selectedProjectId = "";
  } else {
    state.mainView = "project-list";
    if (view !== "project-detail") state.selectedProjectId = "";
  }
  renderActiveView();
}

async function runMemoryMutation(body, options = {}) {
  setActivity("status.memoryActionRunning");
  try {
    const result = await postJson("./api/memory/actions", body);
    await refreshAfterMemoryMutation(options);
    setActivity("status.memoryActionDone", safeArray(result.messages).join(" ") || t("common.none"));
    return result;
  } catch (error) {
    setActivity("status.memoryActionFailed", error instanceof Error ? error.message : String(error));
    return null;
  }
}

function extractDownloadFilename(response, fallback) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return match?.[1] || fallback;
}

/* ── data loading ──────────────────────────────────────── */

function invalidateMemoryCaches() {
  state.projectGroups = [];
  state.projectGroupsLoaded = false;
  state.tmpSnapshot = null;
  state.tmpLoaded = false;
  state.userSummary = null;
  state.userSummaryLoaded = false;
  state.recordCache.clear();
}

function invalidateTraceCaches() {
  state.cases = [];
  state.caseRequestLoaded = false;
  state.caseDetailCache.clear();
  state.selectedCaseId = "";
  state.activeTraceStepId = "";
  state.indexTraces = [];
  state.indexTraceRequestLoaded = false;
  state.indexTraceDetailCache.clear();
  state.selectedIndexTraceId = "";
  state.activeIndexTraceStepId = "";
  state.dreamTraces = [];
  state.dreamTraceRequestLoaded = false;
  state.dreamTraceDetailCache.clear();
  state.selectedDreamTraceId = "";
  state.activeDreamTraceStepId = "";
  state.traceSelectorOpen = false;
}

async function loadSnapshot({ silent = false } = {}) {
  if (!silent) setActivity("status.refreshing");
  const snap = await fetchJson("./api/snapshot?limit=24");
  state.overview = snap.overview || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(snap.settings || {}) };
  if (navLastIndexed) {
    navLastIndexed.textContent = state.overview.lastIndexedAt
      ? formatDateTime(state.overview.lastIndexedAt)
      : t("nav.waiting");
  }
  syncSettingsForm();
  renderOverview();
  renderNav();
  renderBrowserHeader();
  if (!silent) setActivity("status.refreshed");
}

async function loadProjectGroups({ force = false } = {}) {
  if (state.projectGroupsLoaded && !force) return state.projectGroups;
  const params = ["limit=100"];
  if (normalizeText(state.queries.project_list)) params.push(`q=${escapeQueryValue(state.queries.project_list)}`);
  state.projectGroups = safeArray(await fetchJson(`./api/projects?${params.join("&")}`));
  state.projectGroupsLoaded = true;
  return state.projectGroups;
}

async function loadTmpSnapshot({ force = false } = {}) {
  if (state.tmpLoaded && !force) return state.tmpSnapshot;
  const params = ["limit=200"];
  if (normalizeText(state.queries.tmp)) params.push(`q=${escapeQueryValue(state.queries.tmp)}`);
  state.tmpSnapshot = await fetchJson(`./api/tmp?${params.join("&")}`);
  state.tmpLoaded = true;
  return state.tmpSnapshot;
}

async function loadUserSummary({ force = false } = {}) {
  if (state.userSummaryLoaded && !force) return state.userSummary;
  state.userSummary = await fetchJson("./api/memory/user-summary");
  state.userSummaryLoaded = true;
  return state.userSummary;
}

async function getMemoryRecord(id, { force = false } = {}) {
  if (!id) return null;
  if (!force && state.recordCache.has(id)) return state.recordCache.get(id);
  const records = await fetchJson(`./api/memory/get?ids=${escapeQueryValue(id)}`);
  const record = safeArray(records)[0] || null;
  if (record) state.recordCache.set(id, record);
  return record;
}

async function getMemoryRecords(ids, { force = false } = {}) {
  const uniqueIds = Array.from(new Set(safeArray(ids).map((id) => normalizeText(id)).filter(Boolean)));
  const missing = force ? uniqueIds : uniqueIds.filter((id) => !state.recordCache.has(id));
  if (missing.length) {
    const records = safeArray(await fetchJson(`./api/memory/get?ids=${escapeQueryValue(missing.join(","))}`));
    records.forEach((record) => {
      if (record?.relativePath) state.recordCache.set(record.relativePath, record);
    });
  }
  return uniqueIds.map((id) => state.recordCache.get(id)).filter(Boolean);
}

async function loadCases({ force = false } = {}) {
  if (state.caseRequestLoaded && !force) return state.cases;
  state.cases = safeArray(await fetchJson("./api/cases?limit=12"));
  state.caseRequestLoaded = true;
  if (!state.selectedCaseId && state.cases[0]) {
    state.selectedCaseId = state.cases[0].caseId;
  }
  if (state.selectedCaseId) {
    await loadCaseDetail(state.selectedCaseId);
  }
  renderNav();
  return state.cases;
}

async function loadCaseDetail(caseId, { force = false } = {}) {
  if (!caseId) return null;
  if (!force && state.caseDetailCache.has(caseId)) return state.caseDetailCache.get(caseId);
  const detail = await fetchJson(`./api/cases/${encodeURIComponent(caseId)}`);
  state.caseDetailCache.set(caseId, detail);
  if (!state.activeTraceStepId) {
    state.activeTraceStepId = safeArray(detail?.retrieval?.trace?.steps)[0]?.stepId || "";
  }
  return detail;
}

async function loadIndexTraces({ force = false } = {}) {
  if (state.indexTraceRequestLoaded && !force) return state.indexTraces;
  state.indexTraces = safeArray(await fetchJson("./api/index-traces?limit=30"));
  state.indexTraceRequestLoaded = true;
  if (!state.selectedIndexTraceId && state.indexTraces[0]) {
    state.selectedIndexTraceId = state.indexTraces[0].indexTraceId;
  }
  if (state.selectedIndexTraceId) {
    await loadIndexTraceDetail(state.selectedIndexTraceId);
  }
  renderNav();
  return state.indexTraces;
}

async function loadIndexTraceDetail(indexTraceId, { force = false } = {}) {
  if (!indexTraceId) return null;
  if (!force && state.indexTraceDetailCache.has(indexTraceId)) return state.indexTraceDetailCache.get(indexTraceId);
  const detail = await fetchJson(`./api/index-traces/${encodeURIComponent(indexTraceId)}`);
  state.indexTraceDetailCache.set(indexTraceId, detail);
  if (!state.activeIndexTraceStepId) {
    state.activeIndexTraceStepId = safeArray(detail?.steps)[0]?.stepId || "";
  }
  return detail;
}

async function loadDreamTraces({ force = false } = {}) {
  if (state.dreamTraceRequestLoaded && !force) return state.dreamTraces;
  state.dreamTraces = safeArray(await fetchJson("./api/dream-traces?limit=30"));
  state.dreamTraceRequestLoaded = true;
  if (!state.selectedDreamTraceId && state.dreamTraces[0]) {
    state.selectedDreamTraceId = state.dreamTraces[0].dreamTraceId;
  }
  if (state.selectedDreamTraceId) {
    await loadDreamTraceDetail(state.selectedDreamTraceId);
  }
  renderNav();
  return state.dreamTraces;
}

async function loadDreamTraceDetail(dreamTraceId, { force = false } = {}) {
  if (!dreamTraceId) return null;
  if (!force && state.dreamTraceDetailCache.has(dreamTraceId)) return state.dreamTraceDetailCache.get(dreamTraceId);
  const detail = await fetchJson(`./api/dream-traces/${encodeURIComponent(dreamTraceId)}`);
  state.dreamTraceDetailCache.set(dreamTraceId, detail);
  if (!state.activeDreamTraceStepId) {
    state.activeDreamTraceStepId = safeArray(detail?.steps)[0]?.stepId || "";
  }
  return detail;
}

async function ensureActiveData({ force = false } = {}) {
  const level = getCurrentLevel();
  if (level === "project") {
    await Promise.all([
      loadProjectGroups({ force }),
      loadTmpSnapshot({ force }),
    ]);
    return;
  }
  if (level === "tmp") {
    await loadTmpSnapshot({ force });
    return;
  }
  if (level === "user") {
    await loadUserSummary({ force });
    return;
  }
  if (level === "memory_trace") {
    if (state.traceMode === "index") {
      await loadIndexTraces({ force });
    } else if (state.traceMode === "dream") {
      await loadDreamTraces({ force });
    } else {
      await loadCases({ force });
    }
  }
}

/* ── rendering helpers ─────────────────────────────────── */

function createEmptyState(message) {
  return el("div", "empty-state", message);
}

function createMetaChip(label, value) {
  const chip = el("div", "meta-chip");
  const labelEl = el("span", "meta-label", `${label}:`);
  const valueEl = el("span", "", value);
  chip.append(labelEl, valueEl);
  return chip;
}

function appendTextSection(container, label, text, options = {}) {
  const showEmpty = Boolean(options.showEmpty);
  const emptyText = normalizeText(options.emptyText) || t("common.none");
  const value = normalizeText(text);
  if (!value && !showEmpty) return;
  const section = el("section", "detail-section");
  section.append(el("h4", "", label));
  section.append(el("p", "", value || emptyText));
  container.append(section);
}

function appendListSection(container, label, items, options = {}) {
  const showEmpty = Boolean(options.showEmpty);
  const emptyText = normalizeText(options.emptyText) || t("common.none");
  const values = safeArray(items).map((item) => normalizeText(item)).filter(Boolean);
  if (values.length === 0 && !showEmpty) return;
  const section = el("section", "detail-section");
  section.append(el("h4", "", label));
  if (values.length === 0) {
    section.append(el("p", "", emptyText));
  } else {
    const list = el("ul");
    values.forEach((item) => {
      list.append(el("li", "", item));
    });
    section.append(list);
  }
  container.append(section);
}

function createEntryCard({ title, subtitle, badge, meta, active = false, onClick }) {
  const card = el("button", "entry-card");
  card.type = "button";
  if (active) card.classList.add("active");
  const top = el("div", "entry-topline");
  top.append(el("div", "entry-title", title));
  if (badge) top.append(el("span", "entry-badge", badge));
  card.append(top);
  if (subtitle) card.append(el("div", "entry-subtitle", subtitle));
  if (meta) card.append(el("div", "entry-meta", meta));
  if (onClick) card.addEventListener("click", onClick);
  return card;
}

function createBoardGroup(title, count, children) {
  const group = el("section", "board-group");
  const header = el("div", "board-group-header");
  header.append(el("h4", "", title));
  header.append(el("span", "board-group-count", String(count)));
  const grid = el("div", "board-card-grid");
  children.forEach((child) => grid.append(child));
  group.append(header, grid);
  return group;
}

function createBoardCard(entry, { status, active = false, subtitle, meta, onClick }) {
  const card = el("button", "board-card");
  card.type = "button";
  if (status) card.dataset.status = status;
  if (active) card.classList.add("active");
  if (onClick) card.addEventListener("click", onClick);
  card.append(el("div", "board-card-title", entry.name || entry.file || t("common.unknown")));
  if (status) {
    const badge = el("span", "board-card-status", t(`project.${status}`));
    badge.dataset.status = status;
    card.append(badge);
  }
  card.append(el("div", "board-card-body", subtitle || entry.description || t("common.none")));
  const metaParts = normalizeText(meta)
    ? [meta]
    : [formatDateTime(entry.updatedAt), ...(entry.projectId ? [entry.projectId] : [])];
  card.append(el("div", "board-card-meta", metaParts.join(" · ")));
  return card;
}

function createInlineActionBar(actions) {
  const row = el("div", "detail-actions");
  safeArray(actions).forEach((action) => {
    const button = el("button", `tool-btn${action.danger ? " danger" : ""}`, action.label);
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void action.onClick();
    });
    row.append(button);
  });
  return row;
}

function createDetailSectionHeader(label, count) {
  const header = el("div", "detail-section-head");
  header.append(el("h4", "", label));
  if (Number.isFinite(Number(count))) {
    header.append(el("span", "detail-section-count", formatNumber(Number(count))));
  }
  return header;
}

/* ── overview ──────────────────────────────────────────── */

function createOverviewGroup(title, bodyNode) {
  const group = el("section", "ov-group");
  const head = el("div", "ov-group-head");
  head.append(el("span", "ov-group-icon", "•"));
  head.append(el("span", "ov-group-title", title));
  group.append(head, bodyNode);
  return group;
}

function createHeroRow(cells) {
  const row = el("div", "ov-hero-row");
  cells.forEach((cell) => {
    const item = el("div", "ov-hero-cell");
    item.append(el("div", "ov-hero-value", cell.value));
    item.append(el("div", "ov-hero-label", cell.label));
    if (cell.note) item.append(el("div", "ov-hero-note", cell.note));
    row.append(item);
  });
  return row;
}

function createMetricGrid(cells) {
  const grid = el("div", "ov-metric-grid");
  cells.forEach((cell) => {
    const item = el("div", "ov-metric-cell");
    const left = el("div", "ov-metric-left");
    left.append(el("div", "ov-metric-label", cell.label));
    if (cell.note) left.append(el("div", "ov-metric-note", cell.note));
    const right = el("div", "ov-metric-val", cell.value);
    if (cell.tone) right.dataset.tone = cell.tone;
    item.append(left, right);
    grid.append(item);
  });
  return grid;
}

function createOverviewTextNote(text) {
  return el("p", "ov-text-note", normalizeText(text) || t("common.none"));
}

function createOverviewListSection(label, items) {
  const values = safeArray(items).map((item) => normalizeText(item)).filter(Boolean);
  if (!values.length) return null;
  const section = el("section", "ov-diagnostic-section");
  section.append(el("div", "ov-diagnostic-label", label));
  const list = el("ul", "ov-diagnostic-list");
  values.forEach((value) => list.append(el("li", "", value)));
  section.append(list);
  return section;
}

function createDashboardWarningGroup(overview) {
  if (!overview || overview.dashboardStatus === "healthy") return null;
  const diagnostics = overview.dashboardDiagnostics || null;
  const summary = buildDashboardWarningText(overview);
  const body = el("div", "ov-warning-card");
  body.dataset.status = overview.dashboardStatus || "warning";
  body.append(el("div", "ov-warning-summary", summary));

  if (diagnostics) {
    const details = document.createElement("details");
    details.className = "context-block ov-diagnostic-block";
    details.append(el("summary", "", t("overview.warning.viewDiagnostics")));

    const detailBody = el("div", "ov-diagnostic-body");
    const issuesBlock = createOverviewListSection(
      t("overview.diagnostics.issues"),
      diagnostics.issues,
    );
    if (issuesBlock) detailBody.append(issuesBlock);

    const conflictingFileItems = safeArray(diagnostics.conflictingFiles).map((file) => {
      const name = normalizeText(file?.name);
      const conflictPath = normalizeText(file?.conflictPath);
      if (!name) return "";
      return conflictPath ? `${name} · ${conflictPath}` : name;
    });
    const conflictingFilesBlock = createOverviewListSection(
      t("overview.diagnostics.conflictingFiles"),
      conflictingFileItems,
    );
    if (conflictingFilesBlock) detailBody.append(conflictingFilesBlock);

    const startupRepairMessage = normalizeText(diagnostics.startupRepairMessage);
    if (startupRepairMessage) {
      const startupBlock = el("section", "ov-diagnostic-section");
      startupBlock.append(el("div", "ov-diagnostic-label", t("overview.diagnostics.startupRepairMessage")));
      startupBlock.append(el("p", "ov-text-note", startupRepairMessage));
      detailBody.append(startupBlock);
    }

    details.append(detailBody);
    body.append(details);
  }

  return createOverviewGroup(t("overview.group.warning"), body);
}

function renderOverview() {
  if (!overviewCards) return;
  const overview = state.overview || {};
  const memoryBody = el("div");
  memoryBody.append(
    createHeroRow([
      { value: formatNumber(overview.formalProjectCount || 0), label: t("overview.formalProjectCount") },
      { value: formatNumber(overview.tmpTotalFiles || 0), label: t("overview.tmpTotalFiles") },
      { value: formatNumber(overview.userProfileCount || 0), label: t("overview.userProfileCount") },
    ]),
  );
  const pendingCells = [];
  if (Number(overview.pendingSessions || 0) > 0) {
    pendingCells.push({
      label: t("overview.pendingSessions"),
      value: formatNumber(overview.pendingSessions || 0),
      tone: "warning",
    });
  }
  if (pendingCells.length) memoryBody.append(createMetricGrid(pendingCells));
  const memoryGroup = createOverviewGroup(t("overview.group.memory"), memoryBody);

  const activityCells = [];
  if (normalizeText(overview.lastIndexedAt)) {
    activityCells.push({ label: t("overview.lastIndexedAt"), value: formatDateTime(overview.lastIndexedAt) });
  }
  if (normalizeText(overview.lastDreamAt)) {
    activityCells.push({ label: t("overview.lastDreamAt"), value: formatDateTime(overview.lastDreamAt) });
  }
  if (normalizeText(overview.lastDreamStatus)) {
    activityCells.push({ label: t("overview.lastDreamStatus"), value: formatDreamStatus(overview.lastDreamStatus) });
  }
  const activityBody = el("div");
  if (activityCells.length) {
    activityBody.append(createMetricGrid(activityCells));
  } else {
    const emptySection = el("section", "ov-diagnostic-section");
    emptySection.append(createOverviewTextNote(t("common.none")));
    activityBody.append(emptySection);
  }
  if (normalizeText(overview.lastDreamSummary)) {
    const summaryBlock = el("section", "ov-diagnostic-section");
    summaryBlock.append(el("div", "ov-diagnostic-label", t("overview.lastDreamSummary")));
    summaryBlock.append(createOverviewTextNote(overview.lastDreamSummary));
    activityBody.append(summaryBlock);
  }
  const activityGroup = createOverviewGroup(t("overview.group.recall"), activityBody);

  const warningGroup = createDashboardWarningGroup(overview);
  const groups = warningGroup
    ? [memoryGroup, activityGroup, warningGroup]
    : [memoryGroup, activityGroup];
  clearNode(overviewCards).append(...groups);
}

/* ── project / file detail pages ──────────────────────── */

function fillRecordDetail(metaNode, bodyNode, record) {
  clearNode(metaNode);
  metaNode.append(
    createMetaChip(t("meta.type"), t(`type.${record.type}`)),
    createMetaChip(t("meta.scope"), t(`scope.${record.scope}`)),
    ...(record.projectId ? [createMetaChip(t("meta.projectId"), record.projectId)] : []),
    createMetaChip(t("meta.updatedAt"), formatDateTime(record.updatedAt)),
    createMetaChip(t("meta.path"), record.relativePath || t("common.none")),
  );
  const sections = parseSections(record.content);
  clearNode(bodyNode);

  if (record.type === "user") {
    appendTextSection(
      bodyNode,
      t("detail.profile"),
      readTextFromSection(sections.get("Profile")) || readTextFromSection(sections.get("Summary")) || record.description,
      { showEmpty: true },
    );
    appendListSection(bodyNode, t("detail.preferences"), readListFromSection(sections.get("Preferences")), { showEmpty: true });
    appendListSection(bodyNode, t("detail.constraints"), readListFromSection(sections.get("Constraints")), { showEmpty: true });
    appendListSection(bodyNode, t("detail.relationships"), readListFromSection(sections.get("Relationships")), { showEmpty: true });
  } else if (record.type === "feedback") {
    appendTextSection(bodyNode, t("detail.rule"), readTextFromSection(sections.get("Rule")) || record.description);
    appendTextSection(bodyNode, t("detail.why"), readTextFromSection(sections.get("Why")), { showEmpty: true });
    appendTextSection(bodyNode, t("detail.howToApply"), readTextFromSection(sections.get("How to apply")), { showEmpty: true });
    appendListSection(bodyNode, t("detail.notes"), readListFromSection(sections.get("Notes")));
  } else {
    appendTextSection(bodyNode, t("detail.currentStage"), readTextFromSection(sections.get("Current Stage")) || record.description);
    appendListSection(bodyNode, t("detail.decisions"), readListFromSection(sections.get("Decisions")));
    appendListSection(bodyNode, t("detail.constraints"), readListFromSection(sections.get("Constraints")));
    appendListSection(bodyNode, t("detail.nextSteps"), readListFromSection(sections.get("Next Steps")));
    appendListSection(bodyNode, t("detail.blockers"), readListFromSection(sections.get("Blockers")));
    appendListSection(bodyNode, t("detail.timeline"), readListFromSection(sections.get("Timeline")));
    appendListSection(bodyNode, t("detail.notes"), readListFromSection(sections.get("Notes")));
  }
}

function appendMemoryFileListSection(container, label, entries, projectId) {
  if (!safeArray(entries).length) return;
  const section = el("section", "detail-section detail-section-card");
  section.append(createDetailSectionHeader(label, safeArray(entries).length));
  const list = el("div", "entry-stream detail-file-list");
  safeArray(entries).forEach((entry) => {
    const meta = [formatDateTime(entry.updatedAt)];
    if (entry.relativePath) meta.push(entry.relativePath);
    const card = createEntryCard({
      title: entry.name || entry.file || t("common.unknown"),
      subtitle: entry.description || t("common.none"),
      badge: t(`type.${entry.type}`),
      meta: meta.join(" · "),
      active: state.selectedFileId === entry.relativePath,
      onClick: () => void openMemoryDetail(entry.relativePath, { projectId, originView: "project-detail" }),
    });
    const actions = getRecordActions(entry);
    if (actions.length) {
      const wrapper = el("div", "detail-action-card detail-action-card--active");
      wrapper.append(card, createInlineActionBar(actions));
      list.append(wrapper);
      return;
    }
    list.append(card);
  });
  section.append(list);
  container.append(section);
}

function appendDeprecatedMemorySection(container, label, entries, { projectId = "", originView = "project-detail" } = {}) {
  if (!safeArray(entries).length) return;
  const details = document.createElement("details");
  details.className = "detail-section detail-section-card";
  const summary = el("summary", "detail-section-summary", "");
  summary.append(createDetailSectionHeader(label, safeArray(entries).length));
  const list = el("div", "entry-stream detail-file-list");
  safeArray(entries).forEach((record) => {
    const meta = [formatDateTime(record.updatedAt)];
    if (record.relativePath) meta.push(record.relativePath);
    const card = createEntryCard({
      title: record.name || record.file || t("common.unknown"),
      subtitle: record.description || record.preview || t("common.none"),
      badge: t(`type.${record.type}`),
      meta: meta.join(" · "),
      active: state.selectedFileId === record.relativePath,
      onClick: () => void openMemoryDetail(record.relativePath, { projectId, originView }),
    });
    const wrapper = el("div", "detail-action-card");
    wrapper.append(card, createInlineActionBar(getDeprecatedSectionActions(record, { projectId, originView })));
    list.append(wrapper);
  });
  details.append(summary, list);
  container.append(details);
}

function appendTmpFileListSection(container, label, entries) {
  if (!safeArray(entries).length) return;
  const section = el("section", "detail-section detail-section-card");
  section.append(createDetailSectionHeader(label, safeArray(entries).length));
  const list = el("div", "entry-stream detail-file-list");
  safeArray(entries).forEach((record) => {
    const meta = [
      formatDateTime(record.updatedAt),
      record.relativePath || t("common.none"),
      `${t("meta.capturedAt")}: ${formatDateTime(record.capturedAt)}`,
      `${t("meta.sessionKey")}: ${normalizeText(record.sourceSessionKey) || t("common.none")}`,
      `${t("meta.dreamAttempts")}: ${formatNumber(Number(record.dreamAttempts || 0))}`,
    ];
    const card = createEntryCard({
      title: record.name || record.file || t("common.unknown"),
      subtitle: record.description || record.preview || t("common.none"),
      badge: t(`type.${record.type}`),
      meta: meta.join(" · "),
      active: state.selectedFileId === record.relativePath,
      onClick: () => void openMemoryDetail(record.relativePath, { originView: "tmp" }),
    });
    const wrapper = el("div", "detail-action-card");
    wrapper.append(card, createInlineActionBar(getRecordActions(record)));
    list.append(wrapper);
  });
  section.append(list);
  container.append(section);
}

function getSelectedProjectGroup() {
  return safeArray(state.projectGroups).find((item) => item.projectId === state.selectedProjectId) || null;
}

function getVisibleProjectDetailEntries(entries) {
  const query = normalizeText(state.queries.project_detail).toLowerCase();
  if (!query) return safeArray(entries);
  return safeArray(entries).filter((entry) => {
    const haystack = [
      entry.name,
      entry.description,
      entry.relativePath,
      entry.file,
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function getVisibleTmpRecords(records) {
  const query = normalizeText(state.queries.project_list).toLowerCase();
  if (!query) return safeArray(records);
  return safeArray(records).filter((record) => {
    const haystack = [
      record.name,
      record.description,
      record.preview,
      record.relativePath,
      record.file,
      record.sourceSessionKey,
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function getDeprecatedSectionActions(record, { projectId = "", originView = "project-detail" } = {}) {
  return [
    {
      label: t("action.viewDetail"),
      onClick: () => void openMemoryDetail(record.relativePath, { projectId, originView }),
    },
    ...getRecordActions(record),
  ];
}

async function editProjectMeta(group) {
  const payload = await requestActionForm({
    title: t("prompt.editProjectMeta.title"),
    body: t("prompt.editProjectMeta.body"),
    confirmLabel: t("prompt.editProjectMeta.ok"),
    fields: [
      {
        id: "projectName",
        kind: "text",
        label: t("prompt.editProjectMeta.projectName"),
        value: group?.projectName || "",
        span: "half",
      },
      {
        id: "status",
        kind: "select",
        label: t("prompt.editProjectMeta.status"),
        value: normalizeProjectStatusValue(group?.status),
        options: getProjectStatusOptions(group?.status),
        span: "half",
      },
      {
        id: "description",
        kind: "textarea",
        label: t("prompt.editProjectMeta.description"),
        value: group?.description || "",
        rows: 3,
        span: "full",
      },
      {
        id: "aliases",
        kind: "textarea",
        label: t("prompt.editProjectMeta.aliases"),
        value: joinMultilineItems(group?.aliases),
        rows: 3,
        required: false,
        span: "full",
      },
    ],
  });
  if (!payload?.projectName) return;
  await runMemoryMutation(
    {
      action: "edit_project_meta",
      projectId: group.projectId,
      projectName: payload.projectName,
      description: payload.description || "",
      aliases: splitMultilineItems(payload.aliases),
      status: normalizeProjectStatusValue(payload.status),
    },
    { view: "project-detail", projectId: group.projectId },
  );
}

function buildEditEntryPayload(record) {
  const sections = parseSections(record.content);
  if (record.type === "feedback") {
    return {
      title: t("prompt.editEntry.title.feedback"),
      fields: [
        { id: "name", kind: "text", label: t("prompt.editEntry.name"), value: record.name || "" },
        { id: "description", kind: "textarea", label: t("prompt.editEntry.description"), value: record.description || "", rows: 3, required: false, span: "full" },
        { id: "rule", kind: "textarea", label: t("prompt.editEntry.rule"), value: readTextFromSection(sections.get("Rule")) || record.description || "", rows: 4, required: false, span: "full" },
        { id: "why", kind: "textarea", label: t("prompt.editEntry.why"), value: readTextFromSection(sections.get("Why")), rows: 3, required: false, span: "half" },
        { id: "howToApply", kind: "textarea", label: t("prompt.editEntry.howToApply"), value: readTextFromSection(sections.get("How to apply")), rows: 3, required: false, span: "half" },
        { id: "notes", kind: "textarea", label: t("prompt.editEntry.notes"), value: joinMultilineItems(readListFromSection(sections.get("Notes"))), rows: 3, required: false, span: "full" },
      ],
    };
  }
  return {
    title: t("prompt.editEntry.title.project"),
    fields: [
      { id: "name", kind: "text", label: t("prompt.editEntry.name"), value: record.name || "", span: "half" },
      { id: "description", kind: "textarea", label: t("prompt.editEntry.description"), value: record.description || "", rows: 3, required: false, span: "full" },
      { id: "stage", kind: "textarea", label: t("prompt.editEntry.stage"), value: readTextFromSection(sections.get("Current Stage")) || record.description || "", rows: 4, required: false, span: "full" },
      { id: "decisions", kind: "textarea", label: t("prompt.editEntry.decisions"), value: joinMultilineItems(readListFromSection(sections.get("Decisions"))), rows: 3, required: false, span: "half" },
      { id: "constraints", kind: "textarea", label: t("prompt.editEntry.constraints"), value: joinMultilineItems(readListFromSection(sections.get("Constraints"))), rows: 3, required: false, span: "half" },
      { id: "nextSteps", kind: "textarea", label: t("prompt.editEntry.nextSteps"), value: joinMultilineItems(readListFromSection(sections.get("Next Steps"))), rows: 3, required: false, span: "half" },
      { id: "blockers", kind: "textarea", label: t("prompt.editEntry.blockers"), value: joinMultilineItems(readListFromSection(sections.get("Blockers"))), rows: 3, required: false, span: "half" },
      { id: "timeline", kind: "textarea", label: t("prompt.editEntry.timeline"), value: joinMultilineItems(readListFromSection(sections.get("Timeline"))), rows: 3, required: false, span: "half" },
      { id: "notes", kind: "textarea", label: t("prompt.editEntry.notes"), value: joinMultilineItems(readListFromSection(sections.get("Notes"))), rows: 3, required: false, span: "half" },
    ],
  };
}

async function editMemoryRecord(record) {
  const form = buildEditEntryPayload(record);
  const payload = await requestActionForm({
    title: form.title,
    body: t("prompt.editEntry.body"),
    confirmLabel: t("prompt.editEntry.ok"),
    fields: form.fields,
  });
  if (!payload?.name) return;
  const fields = record.type === "feedback"
    ? {
      rule: payload.rule || "",
      why: payload.why || "",
      howToApply: payload.howToApply || "",
      notes: splitMultilineItems(payload.notes),
    }
    : {
      stage: payload.stage || "",
      decisions: splitMultilineItems(payload.decisions),
      constraints: splitMultilineItems(payload.constraints),
      nextSteps: splitMultilineItems(payload.nextSteps),
      blockers: splitMultilineItems(payload.blockers),
      timeline: splitMultilineItems(payload.timeline),
      notes: splitMultilineItems(payload.notes),
    };
  await runMemoryMutation(
    {
      action: "edit_entry",
      id: record.relativePath,
      name: payload.name,
      description: payload.description || "",
      fields,
    },
    {
      view: state.fileReturnView || (record.projectId === "_tmp" ? "project-list" : "project-detail"),
      projectId: record.projectId,
    },
  );
}

async function deleteMemoryRecord(record) {
  const ok = await confirmAction({
    title: t("confirm.memory.delete.title"),
    body: t("confirm.memory.delete.body"),
    confirmLabel: t("confirm.memory.delete.ok"),
  });
  if (!ok) return;
  await runMemoryMutation(
    {
      action: "delete_entries",
      ids: [record.relativePath],
    },
    {
      view: record.projectId === "_tmp" ? "project-list" : (state.fileReturnView || "project-list"),
      projectId: record.projectId,
    },
  );
}

async function deprecateMemoryRecord(record) {
  const ok = await confirmAction({
    title: t("confirm.memory.deprecate.title"),
    body: t("confirm.memory.deprecate.body"),
    confirmLabel: t("confirm.memory.deprecate.ok"),
  });
  if (!ok) return;
  await runMemoryMutation(
    {
      action: "deprecate_entries",
      ids: [record.relativePath],
    },
    {
      view: state.fileReturnView || "project-list",
      projectId: record.projectId,
    },
  );
}

async function restoreMemoryRecord(record) {
  const ok = await confirmAction({
    title: t("confirm.memory.restore.title"),
    body: t("confirm.memory.restore.body"),
    confirmLabel: t("confirm.memory.restore.ok"),
  });
  if (!ok) return;
  await runMemoryMutation(
    {
      action: "restore_entries",
      ids: [record.relativePath],
    },
    {
      view: record.projectId === "_tmp" ? "project-list" : (state.fileReturnView || "project-list"),
      projectId: record.projectId,
    },
  );
}

async function archiveTmpRecordToExistingProject(record) {
  const options = getFormalProjectChoices();
  if (!options.length) {
    setActivity("status.memoryActionFailed", t("action.unavailable"));
    return;
  }
  const payload = await requestActionForm({
    title: t("prompt.archiveExisting.title"),
    body: t("prompt.archiveExisting.body"),
    confirmLabel: t("prompt.archiveExisting.ok"),
    fields: [{
      id: "targetProjectId",
      kind: "select",
      label: t("prompt.archiveExisting.label"),
      value: options[0]?.value || "",
      options,
    }],
  });
  if (!payload?.targetProjectId) return;
  const result = await runMemoryMutation(
    {
      action: "archive_tmp",
      ids: [record.relativePath],
      targetProjectId: payload.targetProjectId,
    },
    {
      view: "project-detail",
      projectId: payload.targetProjectId,
    },
  );
  if (result?.action === "archive_tmp" && payload.targetProjectId) {
    state.selectedProjectId = payload.targetProjectId;
  }
}

async function archiveTmpRecordAsNewProject(record) {
  const payload = await requestActionForm({
    title: t("prompt.archiveNew.title"),
    body: t("prompt.archiveNew.body"),
    confirmLabel: t("prompt.archiveNew.ok"),
    fields: [{
      id: "newProjectName",
      kind: "text",
      label: t("prompt.archiveNew.label"),
      placeholder: t("prompt.archiveNew.placeholder"),
      value: record.name || "",
    }],
  });
  if (!payload?.newProjectName) return;
  await runMemoryMutation(
    {
      action: "archive_tmp",
      ids: [record.relativePath],
      newProjectName: payload.newProjectName,
    },
    { view: "project-list" },
  );
}

function getRecordActions(record) {
  if (!record) return [];
  if (record.deprecated) {
    return [
      {
        label: t("action.restoreMemory"),
        onClick: () => restoreMemoryRecord(record),
      },
      {
        label: t("action.deleteMemory"),
        danger: true,
        onClick: () => deleteMemoryRecord(record),
      },
    ];
  }
  if (record.projectId === "_tmp") {
    const actions = [];
    actions.push({
      label: t("action.editMemory"),
      onClick: () => editMemoryRecord(record),
    });
    if (getFormalProjectChoices().length) {
      actions.push({
        label: t("action.archiveToProject"),
        onClick: () => archiveTmpRecordToExistingProject(record),
      });
    }
    if (record.type === "project") {
      actions.push({
        label: t("action.archiveAsProject"),
        onClick: () => archiveTmpRecordAsNewProject(record),
      });
    }
    actions.push({
      label: t("action.deprecateMemory"),
      onClick: () => deprecateMemoryRecord(record),
    });
    return actions;
  }
  if (record.type === "user") return [];
  return [
    {
      label: t("action.editMemory"),
      onClick: () => editMemoryRecord(record),
    },
    {
      label: t("action.deprecateMemory"),
      onClick: () => deprecateMemoryRecord(record),
    },
  ];
}

function renderProjectDetailView(group) {
  if (!projectDetailTitle || !projectDetailMeta || !projectDetailBody || !projectDetailSubtitle || !projectDetailHeadActions) return;
  if (!group) {
    clearNode(projectDetailMeta);
    clearNode(projectDetailHeadActions);
    projectDetailTitle.textContent = t("detail.title");
    projectDetailSubtitle.textContent = "";
    clearNode(projectDetailBody).append(createEmptyState(t("level.project.empty")));
    return;
  }

  projectDetailTitle.textContent = group.projectName || group.projectId || t("detail.title");
  projectDetailSubtitle.textContent = group.description || "";
  clearNode(projectDetailMeta);
  projectDetailMeta.append(
    createMetaChip(t("meta.type"), t("type.project")),
    createMetaChip(t("meta.scope"), t("scope.project")),
    createMetaChip(t("meta.projectId"), group.projectId || t("common.none")),
    createMetaChip(t("meta.updatedAt"), formatDateTime(group.updatedAt)),
    createMetaChip(t("meta.counts"), `${formatNumber(group.projectCount || 0)} / ${formatNumber(group.feedbackCount || 0)}`),
  );

  clearNode(projectDetailHeadActions).append(createInlineActionBar([
    {
      label: t("action.editProjectMeta"),
      onClick: () => editProjectMeta(group),
    },
  ]));
  clearNode(projectDetailBody);
  const visibleProjectEntries = getVisibleProjectDetailEntries(group.projectEntries);
  const visibleFeedbackEntries = getVisibleProjectDetailEntries(group.feedbackEntries);
  const visibleDeprecatedProjectEntries = getVisibleProjectDetailEntries(group.deprecatedProjectEntries);
  const visibleDeprecatedFeedbackEntries = getVisibleProjectDetailEntries(group.deprecatedFeedbackEntries);
  appendMemoryFileListSection(
    projectDetailBody,
    t("detail.projectFiles"),
    visibleProjectEntries,
    group.projectId,
  );
  appendMemoryFileListSection(
    projectDetailBody,
    t("detail.feedbackFiles"),
    visibleFeedbackEntries,
    group.projectId,
  );
  appendDeprecatedMemorySection(
    projectDetailBody,
    t("board.project.deprecatedProjectFiles"),
    visibleDeprecatedProjectEntries,
    { projectId: group.projectId, originView: "project-detail" },
  );
  appendDeprecatedMemorySection(
    projectDetailBody,
    t("board.project.deprecatedFeedbackFiles"),
    visibleDeprecatedFeedbackEntries,
    { projectId: group.projectId, originView: "project-detail" },
  );
  if (!visibleProjectEntries.length && !visibleFeedbackEntries.length && !visibleDeprecatedProjectEntries.length && !visibleDeprecatedFeedbackEntries.length) {
    projectDetailBody.append(createEmptyState(t("common.none")));
  }
}

function renderTmpBoard() {
  if (!tmpBoard) return;
  clearNode(tmpBoard);
  const snapshot = state.tmpSnapshot;
  const visibleDeprecatedTmpEntries = [
    ...getVisibleTmpRecords(snapshot?.deprecatedProjectEntries),
    ...getVisibleTmpRecords(snapshot?.deprecatedFeedbackEntries),
  ];
  if (!snapshot || (!Number(snapshot.totalFiles || 0) && !visibleDeprecatedTmpEntries.length)) {
    tmpBoard.append(createEmptyState(t("level.tmp.empty")));
    return;
  }

  const page = el("section", "profile-board-card");
  const manifestSection = el("section", "detail-section");
  manifestSection.append(el("h4", "", t("board.tmp.manifest")));
  manifestSection.append(el("p", "", snapshot.manifestPath || t("common.none")));
  manifestSection.append(el("pre", "memory-trace-code", normalizeText(snapshot.manifestContent) || t("common.none")));
  page.append(manifestSection);

  appendTmpFileListSection(page, t("board.tmp.projectFiles"), snapshot.projectEntries);
  appendTmpFileListSection(page, t("board.tmp.feedbackFiles"), snapshot.feedbackEntries);
  appendDeprecatedMemorySection(
    page,
    t("board.project.deprecatedTmpFiles"),
    visibleDeprecatedTmpEntries,
    { projectId: "_tmp", originView: "tmp" },
  );
  tmpBoard.append(page);
}

function renderFileDetailView(record) {
  if (!fileDetailTitle || !fileDetailSubtitle || !fileDetailMeta || !fileDetailBody) return;
  if (fileDetailBackBtn) fileDetailBackBtn.hidden = !state.fileReturnView;
  if (!record) {
    fileDetailTitle.textContent = t("detail.title");
    fileDetailSubtitle.textContent = "";
    clearNode(fileDetailMeta);
    clearNode(fileDetailBody).append(createEmptyState(t("detail.empty")));
    return;
  }
  fileDetailTitle.textContent = record.name || record.file || t("detail.title");
  fileDetailSubtitle.textContent = record.description || "";
  fillRecordDetail(fileDetailMeta, fileDetailBody, record);
  const actions = getRecordActions(record);
  if (actions.length) {
    fileDetailBody.prepend(createInlineActionBar(actions));
  }
}

async function renderCurrentMainView({ force = false } = {}) {
  if (state.mainView === "project-detail") {
    renderProjectDetailView(getSelectedProjectGroup());
    return;
  }
  if (state.mainView === "file-detail" && state.selectedFileId) {
    const record = await getMemoryRecord(state.selectedFileId, { force });
    if (record) state.selectedFileType = normalizeText(record.type);
    renderFileDetailView(record);
    return;
  }
}

async function openMemoryDetail(id, { projectId = "", originView = "" } = {}) {
  const record = await getMemoryRecord(id);
  if (!record) return;
  state.selectedProjectId = projectId || normalizeText(record.projectId);
  state.selectedFileId = id;
  state.selectedFileType = normalizeText(record.type);
  state.fileReturnView = originView || (state.selectedProjectId ? "project-detail" : state.mainView || "project-list");
  state.mainView = "file-detail";
  renderFileDetailView(record);
  renderActiveView();
}

async function openProjectGroupDetail(projectId) {
  const group = safeArray(state.projectGroups).find((item) => item.projectId === projectId);
  if (!group) return;
  state.selectedProjectId = projectId;
  state.selectedFileId = "";
  state.selectedFileType = "";
  state.fileReturnView = "project-list";
  state.mainView = "project-detail";
  renderProjectDetailView(group);
  renderActiveView();
}

/* ── project / user rendering ─────────────────────────── */

function renderProjectListView() {
  const items = getVisibleProjectGroups();
  const tmpSnapshot = state.tmpSnapshot;
  const visibleTmpProjectEntries = getVisibleTmpRecords(tmpSnapshot?.projectEntries);
  const visibleTmpFeedbackEntries = getVisibleTmpRecords(tmpSnapshot?.feedbackEntries);
  const visibleTmpEntries = [...visibleTmpProjectEntries, ...visibleTmpFeedbackEntries];
  const visibleDeprecatedTmpEntries = [
    ...getVisibleTmpRecords(tmpSnapshot?.deprecatedProjectEntries),
    ...getVisibleTmpRecords(tmpSnapshot?.deprecatedFeedbackEntries),
  ];
  clearNode(projectListBoard);
  if (!items.length && !visibleTmpEntries.length && !visibleDeprecatedTmpEntries.length) {
    projectListBoard.append(createEmptyState(t("level.project.empty")));
    return;
  }

  if (items.length) {
    const cards = items.map((group) => createBoardCard({
      name: group.projectName,
      description: group.description,
      updatedAt: group.updatedAt,
      projectId: group.projectId,
    }, {
      status: inferProjectGroupStatus(group),
      active: state.mainView === "project-detail" && state.selectedProjectId === group.projectId,
      subtitle: group.description,
      meta: [
        formatDateTime(group.updatedAt),
        group.projectId,
        t("board.project.memoryCount", group.projectCount || 0),
        t("board.project.feedbackCount", group.feedbackCount || 0),
      ].join(" · "),
      onClick: () => void openProjectGroupDetail(group.projectId),
    }));

    projectListBoard.append(createBoardGroup(t("board.project"), items.length, cards));
  }

  if (visibleTmpEntries.length) {
    const tmpCards = visibleTmpEntries.map((record) => createBoardCard({
      name: record.name || record.file,
      description: record.description || record.preview,
      updatedAt: record.updatedAt,
      projectId: record.projectId,
    }, {
      subtitle: record.description || record.preview || t("common.none"),
      meta: [
        formatDateTime(record.updatedAt),
        t(`type.${record.type}`),
        `${t("meta.sessionKey")}: ${normalizeText(record.sourceSessionKey) || t("common.none")}`,
      ].join(" · "),
      onClick: () => void openMemoryDetail(record.relativePath, { originView: "project-list" }),
    }));
    projectListBoard.append(createBoardGroup(t("board.project.unarchived"), visibleTmpEntries.length, tmpCards));
  }

  if (visibleDeprecatedTmpEntries.length) {
    const details = document.createElement("details");
    details.className = "board-group";
    details.append(el("summary", "board-group-header", `${t("board.project.deprecatedTmpFiles")} · ${formatNumber(visibleDeprecatedTmpEntries.length)}`));
    const list = el("div", "entry-stream detail-file-list");
    visibleDeprecatedTmpEntries.forEach((record) => {
      const meta = [
        formatDateTime(record.updatedAt),
        record.relativePath || t("common.none"),
      ];
      const card = createEntryCard({
        title: record.name || record.file || t("common.unknown"),
        subtitle: record.description || record.preview || t("common.none"),
        badge: t(`type.${record.type}`),
        meta: meta.join(" · "),
        active: state.selectedFileId === record.relativePath,
        onClick: () => void openMemoryDetail(record.relativePath, { originView: "project-list" }),
      });
      const wrapper = el("div", "detail-action-card");
      wrapper.append(card, createInlineActionBar(getDeprecatedSectionActions(record, { projectId: "_tmp", originView: "project-list" })));
      list.append(wrapper);
    });
    details.append(list);
    projectListBoard.append(details);
  }
}

function renderUserBoard() {
  const summary = state.userSummary;
  clearNode(userBoard);
  if (
    !summary
    || (
      !normalizeText(summary.profile)
      && !safeArray(summary.preferences).length
      && !safeArray(summary.constraints).length
      && !safeArray(summary.relationships).length
      && !safeArray(summary.files).length
    )
  ) {
    userBoard.append(createEmptyState(t("board.user.empty")));
    return;
  }

  const card = el("section", "profile-board-card");
  const addSummaryText = (label, text) => {
    const value = normalizeText(text);
    card.append(el("div", "profile-section-title", label));
    if (!value) {
      card.append(el("p", "profile-para", t("common.none")));
      return;
    }
    value.split(/\n+/).forEach((line) => {
      if (!normalizeText(line)) return;
      card.append(el("p", "profile-para", normalizeText(line)));
    });
  };
  const addSummaryList = (label, items) => {
    const values = safeArray(items).map((item) => normalizeText(item)).filter(Boolean);
    card.append(el("div", "profile-section-title", label));
    if (!values.length) {
      card.append(el("p", "profile-para", t("common.none")));
      return;
    }
    const list = el("div", "profile-topic-list");
    values.forEach((item) => {
      list.append(el("span", "profile-topic-chip", item));
    });
    card.append(list);
  };

  addSummaryText(t("detail.profile"), summary.profile);
  addSummaryList(t("detail.preferences"), summary.preferences);
  addSummaryList(t("detail.constraints"), summary.constraints);
  addSummaryList(t("detail.relationships"), summary.relationships);

  const files = safeArray(summary.files);
  if (files.length) {
    card.append(el("div", "profile-section-title", t("board.user.sources")));
    const list = el("div", "profile-topic-list");
    files.forEach((entry) => {
      const chip = el("button", "profile-topic-chip", entry.name || entry.file);
      chip.type = "button";
      chip.addEventListener("click", () => void openMemoryDetail(entry.relativePath, { originView: "user" }));
      list.append(chip);
    });
    card.append(list);
  }

  userBoard.append(card);
}

/* ── memory trace rendering ────────────────────────────── */

function getVisibleCases() {
  const query = normalizeText(state.queries.memory_trace).toLowerCase();
  if (!query) return state.cases;
  return state.cases.filter((item) => {
    const haystack = [
      decodeEscapedTraceText(item.query),
      item.sessionKey,
      decodeEscapedTraceText(item.assistantReply),
      normalizeText(item.retrieval?.intent),
      decodeEscapedTraceText(item.retrieval?.contextPreview),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function getSelectedCase() {
  const visibleCases = getVisibleCases();
  const selected = state.caseDetailCache.get(state.selectedCaseId)
    || visibleCases.find((item) => item.caseId === state.selectedCaseId)
    || visibleCases[0]
    || null;
  if (selected && state.selectedCaseId !== selected.caseId) {
    state.selectedCaseId = selected.caseId;
  }
  return selected;
}

function getVisibleIndexTraces() {
  const query = normalizeText(state.queries.memory_trace).toLowerCase();
  const filteredByTrigger = state.indexTraceFilterTrigger === "all"
    ? state.indexTraces
    : state.indexTraces.filter((item) => item.trigger === state.indexTraceFilterTrigger);
  if (!query) return filteredByTrigger;
  return filteredByTrigger.filter((item) => {
    const haystack = [
      item.sessionKey,
      item.trigger,
      safeArray(item.storedResults).map((result) => [
        decodeEscapedTraceText(result.candidateName),
        result.candidateType,
        result.relativePath,
        result.projectId,
      ].join(" ")).join(" "),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function getSelectedIndexTrace() {
  const visibleTraces = getVisibleIndexTraces();
  const selected = state.indexTraceDetailCache.get(state.selectedIndexTraceId)
    || visibleTraces.find((item) => item.indexTraceId === state.selectedIndexTraceId)
    || visibleTraces[0]
    || null;
  if (selected && state.selectedIndexTraceId !== selected.indexTraceId) {
    state.selectedIndexTraceId = selected.indexTraceId;
  }
  return selected;
}

function getVisibleDreamTraces() {
  const query = normalizeText(state.queries.memory_trace).toLowerCase();
  const filteredByTrigger = state.dreamTraceFilterTrigger === "all"
    ? state.dreamTraces
    : state.dreamTraces.filter((item) => item.trigger === state.dreamTraceFilterTrigger);
  if (!query) return filteredByTrigger;
  return filteredByTrigger.filter((item) => {
    const haystack = [
      item.trigger,
      normalizeText(item.outcome?.summary),
      safeArray(item.mutations).map((mutation) => [
        mutation.relativePath,
        decodeEscapedTraceText(mutation.projectName),
        decodeEscapedTraceText(mutation.name),
        decodeEscapedTraceText(mutation.preview),
      ].join(" ")).join(" "),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function getSelectedDreamTrace() {
  const visibleTraces = getVisibleDreamTraces();
  const selected = state.dreamTraceDetailCache.get(state.selectedDreamTraceId)
    || visibleTraces.find((item) => item.dreamTraceId === state.selectedDreamTraceId)
    || visibleTraces[0]
    || null;
  if (selected && state.selectedDreamTraceId !== selected.dreamTraceId) {
    state.selectedDreamTraceId = selected.dreamTraceId;
  }
  return selected;
}

function formatIndexTrigger(trigger) {
  return formatTraceRawValue(trigger);
}

function formatDreamTrigger(trigger) {
  return formatTraceRawValue(trigger);
}

function renderTraceModeControls(container) {
  const tabs = el("div", "memory-trace-artifact-tabs");
  [
    { id: "recall", label: t("board.memoryTrace.modeRecall") },
    { id: "index", label: t("board.memoryTrace.modeIndex") },
    { id: "dream", label: t("board.memoryTrace.modeDream") },
  ].forEach((item) => {
    const button = el("button", `memory-trace-artifact-tab${state.traceMode === item.id ? " active" : ""}`, item.label);
    button.type = "button";
    button.addEventListener("click", async () => {
      if (state.traceMode === item.id) return;
      state.traceMode = item.id;
      state.traceSelectorOpen = false;
      await ensureActiveData();
      renderActiveView();
    });
    tabs.append(button);
  });
  container.append(tabs);
}

function renderDreamTriggerFilters(container) {
  const tabs = el("div", "memory-trace-artifact-tabs");
  [
    { id: "all", label: t("board.memoryTrace.filterAll") },
    { id: "manual", label: t("board.memoryTrace.filterManual") },
    { id: "scheduled", label: t("board.memoryTrace.filterScheduled") },
  ].forEach((item) => {
    const button = el("button", `memory-trace-artifact-tab${state.dreamTraceFilterTrigger === item.id ? " active" : ""}`, item.label);
    button.type = "button";
    button.addEventListener("click", () => {
      if (state.dreamTraceFilterTrigger === item.id) return;
      state.dreamTraceFilterTrigger = item.id;
      state.traceSelectorOpen = false;
      state.selectedDreamTraceId = "";
      state.activeDreamTraceStepId = "";
      renderActiveView();
    });
    tabs.append(button);
  });
  container.append(tabs);
}

function renderIndexTriggerFilters(container) {
  const tabs = el("div", "memory-trace-artifact-tabs");
  [
    { id: "all", label: t("board.memoryTrace.filterAll") },
    { id: "explicit_remember", label: t("board.memoryTrace.filterExplicitRemember") },
    { id: "manual_sync", label: t("board.memoryTrace.filterManualSync") },
    { id: "scheduled", label: t("board.memoryTrace.filterScheduled") },
  ].forEach((item) => {
    const button = el("button", `memory-trace-artifact-tab${state.indexTraceFilterTrigger === item.id ? " active" : ""}`, item.label);
    button.type = "button";
    button.addEventListener("click", () => {
      if (state.indexTraceFilterTrigger === item.id) return;
      state.indexTraceFilterTrigger = item.id;
      state.traceSelectorOpen = false;
      state.selectedIndexTraceId = "";
      state.activeIndexTraceStepId = "";
      renderActiveView();
    });
    tabs.append(button);
  });
  container.append(tabs);
}

function createTraceDetailBlock(detail) {
  const block = el("div", `memory-trace-detail-block${detail.kind === "note" ? " is-note" : ""}`);
  block.append(el("div", "memory-trace-debug-title", renderTraceLabel(detail)));

  if (detail.kind === "text" || detail.kind === "note") {
    block.append(el("pre", "memory-trace-code", decodeEscapedTraceText(detail.text || t("common.none"))));
    return block;
  }

  if (detail.kind === "list") {
    const list = el("ul", "memory-trace-detail-list");
    safeArray(detail.items).forEach((item) => list.append(el("li", "", decodeEscapedTraceText(item))));
    block.append(list);
    return block;
  }

  if (detail.kind === "kv") {
    const grid = el("div", "memory-trace-kv-grid");
    safeArray(detail.entries).forEach((entry) => {
      const row = el("div", "memory-trace-kv-row");
      row.append(el("span", "memory-trace-kv-key", entry.label));
      row.append(el("span", "memory-trace-kv-value", decodeEscapedTraceText(String(entry.value ?? ""))));
      grid.append(row);
    });
    block.append(grid);
    return block;
  }

  block.append(el("pre", "memory-trace-code", safeJson(detail.json)));
  return block;
}

function renderPromptDebug(container, promptDebug) {
  if (!promptDebug) return;
  const wrapper = el("details", "memory-trace-debug-block");
  wrapper.append(el("summary", "", t("board.memoryTrace.promptDebug")));
  const body = el("div");
  body.append(el("div", "memory-trace-debug-title", t("board.memoryTrace.systemPrompt")));
  body.append(el("pre", "memory-trace-code", decodeEscapedTraceText(promptDebug.systemPrompt || t("common.none"))));
  body.append(el("div", "memory-trace-debug-title", t("board.memoryTrace.userPrompt")));
  body.append(el("pre", "memory-trace-code", decodeEscapedTraceText(promptDebug.userPrompt || t("common.none"))));
  body.append(el("div", "memory-trace-debug-title", t("board.memoryTrace.rawOutput")));
  body.append(el("pre", "memory-trace-code", decodeEscapedTraceText(promptDebug.rawResponse || t("common.none"))));
  if (promptDebug.parsedResult !== undefined) {
    body.append(el("div", "memory-trace-debug-title", t("board.memoryTrace.parsedResult")));
    body.append(el("pre", "memory-trace-code", safeJson(promptDebug.parsedResult)));
  }
  wrapper.append(body);
  container.append(wrapper);
}

function pickDefaultTraceStepId(steps) {
  const normalized = safeArray(steps);
  const promptStep = normalized.find((step) => step?.promptDebug);
  if (promptStep?.stepId) return promptStep.stepId;
  const detailStep = normalized.find((step) => safeArray(step?.details).length > 0);
  if (detailStep?.stepId) return detailStep.stepId;
  return normalized[0]?.stepId || "";
}

function renderTraceStepExpandedContent(expanded, step) {
  const details = safeArray(step.details);
  const hasPromptDebug = Boolean(step.promptDebug);

  if (details.length) {
    details.forEach((detail) => expanded.append(createTraceDetailBlock(detail)));
  }

  if (hasPromptDebug) {
    renderPromptDebug(expanded, step.promptDebug);
  }
}

function createTraceMetaChip(label, value) {
  const chip = el("div", "memory-trace-meta-chip");
  chip.append(el("div", "memory-trace-meta-label", label));
  chip.append(el("div", "memory-trace-meta-value", decodeEscapedTraceText(value)));
  return chip;
}

function createTraceSummaryCard(title, bodyText, klass = "") {
  const card = el("section", `memory-trace-summary-card${klass ? ` ${klass}` : ""}`);
  card.append(el("h4", "", title));
  card.append(el("pre", "memory-trace-note", decodeEscapedTraceText(bodyText || t("common.none"))));
  return card;
}

function traceStepLabel(step) {
  const localizedTitle = renderTraceText(step?.title, step?.titleI18n);
  if (localizedTitle && localizedTitle !== step?.kind) return localizedTitle;
  const explicitTitle = normalizeText(step?.title);
  if (explicitTitle && explicitTitle !== step?.kind) return explicitTitle;
  const key = `trace.step.${step?.kind || "unknown"}`;
  const hasTranslation = Boolean(LOCALES[state.locale][key] || LOCALES.en[key]);
  return hasTranslation ? t(key) : (step?.title || t("trace.step.unknown"));
}

function renderRecallTrace(host) {
  const cases = getVisibleCases();
  clearNode(host);
  if (!cases.length) {
    host.append(createEmptyState(t("level.memory_trace.empty")));
    return;
  }

  const selected = getSelectedCase();
  if (!selected) {
    host.append(createEmptyState(t("board.memoryTrace.empty")));
    return;
  }

  const page = el("div", "memory-trace-page");
  const hero = el("section", "memory-trace-hero");
  const header = el("div", "memory-trace-section-head");
  header.append(el("h4", "", t("board.memoryTrace.selectCase")));

  const selector = el("div", "memory-trace-selector");
  const trigger = el("button", "memory-trace-selector-trigger");
  trigger.type = "button";
  trigger.append(el("span", "memory-trace-selector-title", decodeEscapedTraceText(selected.query || selected.caseId)));
  trigger.append(el("span", "memory-trace-selector-chevron", state.traceSelectorOpen ? "▴" : "▾"));
  trigger.addEventListener("click", () => {
    state.traceSelectorOpen = !state.traceSelectorOpen;
    renderActiveView();
  });
  selector.append(trigger);

  if (state.traceSelectorOpen) {
    const list = el("div", "memory-trace-selector-list");
    cases.forEach((item) => {
      const option = el("button", `memory-trace-selector-option${item.caseId === selected.caseId ? " active" : ""}`);
      option.type = "button";
      option.append(el("div", "memory-trace-selector-option-title", decodeEscapedTraceText(item.query || item.caseId)));
      option.append(el("div", "memory-trace-selector-option-meta", `${item.sessionKey} · ${formatDateTime(item.startedAt)}`));
      option.addEventListener("click", async () => {
        state.selectedCaseId = item.caseId;
        state.traceSelectorOpen = false;
        await loadCaseDetail(item.caseId);
        renderActiveView();
      });
      list.append(option);
    });
    selector.append(list);
  }

  header.append(selector);
  hero.append(header);

  const retrieval = selected.retrieval || {};
  const trace = retrieval.trace || { steps: [] };
  const metaGrid = el("div", "memory-trace-meta-grid");
  metaGrid.append(
    createTraceMetaChip(t("board.memoryTrace.query"), selected.query || t("common.none")),
    createTraceMetaChip(t("board.memoryTrace.session"), selected.sessionKey || t("common.none")),
    createTraceMetaChip(t("board.memoryTrace.mode"), formatTraceRawValue(trace.mode)),
    createTraceMetaChip(t("board.memoryTrace.route"), formatTraceRawValue(retrieval.intent)),
    createTraceMetaChip(t("board.memoryTrace.status"), formatTraceRawValue(selected.status)),
    createTraceMetaChip(t("board.memoryTrace.injected"), retrieval.injected ? t("common.yes") : t("common.no")),
    createTraceMetaChip(t("board.memoryTrace.started"), formatDateTime(selected.startedAt)),
    createTraceMetaChip(t("board.memoryTrace.finished"), formatDateTime(selected.finishedAt)),
  );
  hero.append(metaGrid);

  const summaryGrid = el("div", "memory-trace-summary-grid");
  summaryGrid.append(
    createTraceSummaryCard(t("board.memoryTrace.context"), retrieval.contextPreview || t("common.none"), "memory-trace-summary-card--artifact"),
    createTraceSummaryCard(
      t("board.memoryTrace.tools"),
      safeArray(selected.toolEvents).map((event) => `${event.toolName} · ${renderTraceSummary(event.summary, event.summaryI18n)}`).join("\n") || t("common.none"),
      "memory-trace-summary-card--artifact",
    ),
    createTraceSummaryCard(t("board.memoryTrace.answer"), selected.assistantReply || t("common.none"), "memory-trace-summary-card--artifact"),
  );
  hero.append(summaryGrid);
  page.append(hero);

  const flow = el("section", "memory-trace-flow");
  const flowHeader = el("div", "memory-trace-section-head");
  flowHeader.append(el("h4", "", t("board.memoryTrace.flow")));
  flow.append(flowHeader);
  const steps = safeArray(trace.steps);
  if (!steps.length) {
    flow.append(createEmptyState(t("board.memoryTrace.noTrace")));
    page.append(flow);
    host.append(page);
    return;
  }

  if (!state.activeTraceStepId || !steps.some((step) => step.stepId === state.activeTraceStepId)) {
    state.activeTraceStepId = pickDefaultTraceStepId(steps);
  }

  const list = el("div", "memory-trace-flow-list");
  steps.forEach((step, index) => {
    const isActive = step.stepId === state.activeTraceStepId;
    const item = el("div", `memory-trace-step-item${step.stepId === state.activeTraceStepId ? " active" : ""}`);
    const toggle = el("button", "memory-trace-step-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", isActive ? "true" : "false");
    toggle.addEventListener("click", () => {
      state.activeTraceStepId = state.activeTraceStepId === step.stepId ? "" : step.stepId;
      renderActiveView();
    });

    toggle.append(el("span", "memory-trace-step-marker", String(index + 1)));
    const summary = el("div", "memory-trace-step-summary");
    const head = el("div", "memory-trace-step-head");
    head.append(el("strong", "", traceStepLabel(step)));
    head.append(el("span", "memory-trace-kind-badge", step.kind));
    summary.append(head);
    summary.append(el("div", "memory-trace-step-line", decodeEscapedTraceText(renderTraceSummary(step.inputSummary, step.inputSummaryI18n))));
    summary.append(el("div", "memory-trace-step-line is-output", decodeEscapedTraceText(renderTraceSummary(step.outputSummary, step.outputSummaryI18n))));
    toggle.append(summary);
    toggle.append(el("span", "memory-trace-step-chevron", isActive ? "▴" : "▾"));
    item.append(toggle);

    if (isActive) {
      const expanded = el("div", "memory-trace-step-expanded");
      const meta = el("div", "memory-trace-expanded-meta");
      meta.append(
        createTraceMetaChip(t("board.memoryTrace.status"), formatTraceRawValue(step.status)),
        createTraceMetaChip(t("board.memoryTrace.kind"), formatTraceRawValue(step.kind)),
      );
      expanded.append(meta);
      renderTraceStepExpandedContent(expanded, step);
      item.append(expanded);
    }

    list.append(item);
  });
  flow.append(list);
  page.append(flow);
  host.append(page);
}

function renderIndexTrace(host) {
  const traces = getVisibleIndexTraces();
  clearNode(host);
  if (!traces.length) {
    host.append(createEmptyState(t("board.memoryTrace.emptyIndex")));
    return;
  }

  const selected = getSelectedIndexTrace();
  if (!selected) {
    host.append(createEmptyState(t("board.memoryTrace.emptyIndex")));
    return;
  }

  const page = el("div", "memory-trace-page");
  const hero = el("section", "memory-trace-hero");
  const header = el("div", "memory-trace-section-head");
  header.append(el("h4", "", t("board.memoryTrace.selectIndexTrace")));

  const selector = el("div", "memory-trace-selector");
  const trigger = el("button", "memory-trace-selector-trigger");
  trigger.type = "button";
  trigger.append(el("span", "memory-trace-selector-title", `${formatTraceRawValue(selected.trigger)} · ${selected.sessionKey}`));
  trigger.append(el("span", "memory-trace-selector-chevron", state.traceSelectorOpen ? "▴" : "▾"));
  trigger.addEventListener("click", () => {
    state.traceSelectorOpen = !state.traceSelectorOpen;
    renderActiveView();
  });
  selector.append(trigger);

  if (state.traceSelectorOpen) {
    const list = el("div", "memory-trace-selector-list");
    traces.forEach((item) => {
      const option = el("button", `memory-trace-selector-option${item.indexTraceId === selected.indexTraceId ? " active" : ""}`);
      option.type = "button";
      option.append(el("div", "memory-trace-selector-option-title", `${formatTraceRawValue(item.trigger)} · ${item.sessionKey}`));
      option.append(el(
        "div",
        "memory-trace-selector-option-meta",
        t("board.memoryTrace.indexSelectorMeta", formatDateTime(item.startedAt), item.batchSummary?.segmentCount || 0, safeArray(item.storedResults).length),
      ));
      option.addEventListener("click", async () => {
        state.selectedIndexTraceId = item.indexTraceId;
        state.traceSelectorOpen = false;
        await loadIndexTraceDetail(item.indexTraceId);
        renderActiveView();
      });
      list.append(option);
    });
    selector.append(list);
  }

  header.append(selector);
  hero.append(header);

  const metaGrid = el("div", "memory-trace-meta-grid");
  metaGrid.append(
    createTraceMetaChip(t("board.memoryTrace.trigger"), formatTraceRawValue(selected.trigger)),
    createTraceMetaChip(t("board.memoryTrace.session"), selected.sessionKey || t("common.none")),
    createTraceMetaChip(t("board.memoryTrace.status"), formatTraceRawValue(selected.status)),
    createTraceMetaChip(t("board.memoryTrace.started"), formatDateTime(selected.startedAt)),
    createTraceMetaChip(t("board.memoryTrace.finished"), formatDateTime(selected.finishedAt)),
    createTraceMetaChip(t("board.memoryTrace.focusTurns"), String(selected.batchSummary?.focusUserTurnCount || 0)),
  );
  hero.append(metaGrid);

  const summaryGrid = el("div", "memory-trace-summary-grid");
  summaryGrid.append(
    createTraceSummaryCard(
      t("board.memoryTrace.batchWindow"),
      `${formatDateTime(selected.batchSummary?.fromTimestamp)} → ${formatDateTime(selected.batchSummary?.toTimestamp)}`,
      "memory-trace-summary-card--path",
    ),
    createTraceSummaryCard(
      t("board.memoryTrace.storedResults"),
      safeArray(selected.storedResults).map((item) => `${item.candidateType}:${item.candidateName} -> ${item.relativePath}`).join("\n") || t("common.none"),
      "memory-trace-summary-card--artifact",
    ),
  );
  hero.append(summaryGrid);
  page.append(hero);

  const flow = el("section", "memory-trace-flow");
  const flowHeader = el("div", "memory-trace-section-head");
  flowHeader.append(el("h4", "", t("board.memoryTrace.flow")));
  flow.append(flowHeader);
  const steps = safeArray(selected.steps);
  if (!steps.length) {
    flow.append(createEmptyState(t("board.memoryTrace.noTrace")));
    page.append(flow);
    host.append(page);
    return;
  }

  if (!state.activeIndexTraceStepId || !steps.some((step) => step.stepId === state.activeIndexTraceStepId)) {
    state.activeIndexTraceStepId = pickDefaultTraceStepId(steps);
  }

  const list = el("div", "memory-trace-flow-list");
  steps.forEach((step, index) => {
    const isActive = step.stepId === state.activeIndexTraceStepId;
    const item = el("div", `memory-trace-step-item${step.stepId === state.activeIndexTraceStepId ? " active" : ""}`);
    const toggle = el("button", "memory-trace-step-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", isActive ? "true" : "false");
    toggle.addEventListener("click", () => {
      state.activeIndexTraceStepId = state.activeIndexTraceStepId === step.stepId ? "" : step.stepId;
      renderActiveView();
    });

    toggle.append(el("span", "memory-trace-step-marker", String(index + 1)));
    const summary = el("div", "memory-trace-step-summary");
    const head = el("div", "memory-trace-step-head");
    head.append(el("strong", "", traceStepLabel(step)));
    head.append(el("span", "memory-trace-kind-badge", step.kind));
    summary.append(head);
    summary.append(el("div", "memory-trace-step-line", renderTraceSummary(step.inputSummary, step.inputSummaryI18n)));
    summary.append(el("div", "memory-trace-step-line is-output", renderTraceSummary(step.outputSummary, step.outputSummaryI18n)));
    toggle.append(summary);
    toggle.append(el("span", "memory-trace-step-chevron", isActive ? "▴" : "▾"));
    item.append(toggle);

    if (isActive) {
      const expanded = el("div", "memory-trace-step-expanded");
      const meta = el("div", "memory-trace-expanded-meta");
      meta.append(
        createTraceMetaChip(t("board.memoryTrace.status"), formatTraceRawValue(step.status)),
        createTraceMetaChip(t("board.memoryTrace.kind"), formatTraceRawValue(step.kind)),
      );
      expanded.append(meta);
      renderTraceStepExpandedContent(expanded, step);
      item.append(expanded);
    }

    list.append(item);
  });
  flow.append(list);
  page.append(flow);
  host.append(page);
}

function renderDreamTrace(host) {
  const traces = getVisibleDreamTraces();
  clearNode(host);
  if (!traces.length) {
    host.append(createEmptyState(t("board.memoryTrace.emptyDream")));
    return;
  }

  const selected = getSelectedDreamTrace();
  if (!selected) {
    host.append(createEmptyState(t("board.memoryTrace.emptyDream")));
    return;
  }

  const page = el("div", "memory-trace-page");
  const hero = el("section", "memory-trace-hero");
  const header = el("div", "memory-trace-section-head");
  header.append(el("h4", "", t("board.memoryTrace.selectDreamTrace")));

  const selector = el("div", "memory-trace-selector");
  const trigger = el("button", "memory-trace-selector-trigger");
  trigger.type = "button";
  trigger.append(el("span", "memory-trace-selector-title", `${formatTraceRawValue(selected.trigger)} · ${formatDateTime(selected.startedAt)}`));
  trigger.append(el("span", "memory-trace-selector-chevron", state.traceSelectorOpen ? "▴" : "▾"));
  trigger.addEventListener("click", () => {
    state.traceSelectorOpen = !state.traceSelectorOpen;
    renderActiveView();
  });
  selector.append(trigger);

  if (state.traceSelectorOpen) {
    const list = el("div", "memory-trace-selector-list");
    traces.forEach((item) => {
      const option = el("button", `memory-trace-selector-option${item.dreamTraceId === selected.dreamTraceId ? " active" : ""}`);
      option.type = "button";
      option.append(el("div", "memory-trace-selector-option-title", `${formatTraceRawValue(item.trigger)} · ${formatDateTime(item.startedAt)}`));
      option.append(el(
        "div",
        "memory-trace-selector-option-meta",
        t(
          "board.memoryTrace.dreamSelectorMeta",
          item.snapshotSummary?.formalProjectCount || 0,
          item.outcome?.rewrittenProjects || 0,
          item.outcome?.deletedFiles || 0,
        ),
      ));
      option.addEventListener("click", async () => {
        state.selectedDreamTraceId = item.dreamTraceId;
        state.traceSelectorOpen = false;
        await loadDreamTraceDetail(item.dreamTraceId);
        renderActiveView();
      });
      list.append(option);
    });
    selector.append(list);
  }

  header.append(selector);
  hero.append(header);

  const metaGrid = el("div", "memory-trace-meta-grid");
  metaGrid.append(
    createTraceMetaChip(t("board.memoryTrace.trigger"), formatTraceRawValue(selected.trigger)),
    createTraceMetaChip(t("board.memoryTrace.status"), formatTraceRawValue(selected.status)),
    createTraceMetaChip(t("board.memoryTrace.started"), formatDateTime(selected.startedAt)),
    createTraceMetaChip(t("board.memoryTrace.finished"), formatDateTime(selected.finishedAt)),
    createTraceMetaChip(t("board.memoryTrace.rewrittenProjects"), String(selected.outcome?.rewrittenProjects || 0)),
    createTraceMetaChip(t("board.memoryTrace.deletedProjects"), String(selected.outcome?.deletedProjects || 0)),
    createTraceMetaChip(t("board.memoryTrace.deletedFiles"), String(selected.outcome?.deletedFiles || 0)),
  );
  hero.append(metaGrid);

  const summaryGrid = el("div", "memory-trace-summary-grid");
  summaryGrid.append(
    createTraceSummaryCard(
      t("board.memoryTrace.snapshot"),
      [
        `${t("board.memoryTrace.snapshotFormalProjects")}: ${selected.snapshotSummary?.formalProjectCount || 0}`,
        `${t("board.memoryTrace.snapshotTmpProjectFiles")}: ${selected.snapshotSummary?.tmpProjectCount || 0}`,
        `${t("board.memoryTrace.snapshotTmpFeedbackFiles")}: ${selected.snapshotSummary?.tmpFeedbackCount || 0}`,
        `${t("board.memoryTrace.snapshotFormalProjectFiles")}: ${selected.snapshotSummary?.formalProjectFileCount || 0}`,
        `${t("board.memoryTrace.snapshotFormalFeedbackFiles")}: ${selected.snapshotSummary?.formalFeedbackFileCount || 0}`,
        `${t("board.memoryTrace.snapshotHasUserProfile")}: ${selected.snapshotSummary?.hasUserProfile ? t("common.yes") : t("common.no")}`,
      ].join("\n"),
      "memory-trace-summary-card--path",
    ),
    createTraceSummaryCard(
      t("board.memoryTrace.mutations"),
      safeArray(selected.mutations).map((item) => `${item.action} · ${item.relativePath || item.projectName || item.projectId || t("common.none")}`).join("\n") || t("common.none"),
      "memory-trace-summary-card--artifact",
    ),
    createTraceSummaryCard(
      t("overview.lastDreamSummary"),
      renderTraceSummary(selected.outcome?.summary, selected.outcome?.summaryI18n),
      "memory-trace-summary-card--artifact",
    ),
  );
  hero.append(summaryGrid);
  page.append(hero);

  const flow = el("section", "memory-trace-flow");
  const flowHeader = el("div", "memory-trace-section-head");
  flowHeader.append(el("h4", "", t("board.memoryTrace.flow")));
  flow.append(flowHeader);
  const steps = safeArray(selected.steps);
  if (!steps.length) {
    flow.append(createEmptyState(t("board.memoryTrace.noTrace")));
    page.append(flow);
    host.append(page);
    return;
  }

  if (!state.activeDreamTraceStepId || !steps.some((step) => step.stepId === state.activeDreamTraceStepId)) {
    state.activeDreamTraceStepId = pickDefaultTraceStepId(steps);
  }

  const list = el("div", "memory-trace-flow-list");
  steps.forEach((step, index) => {
    const isActive = step.stepId === state.activeDreamTraceStepId;
    const item = el("div", `memory-trace-step-item${step.stepId === state.activeDreamTraceStepId ? " active" : ""}`);
    const toggle = el("button", "memory-trace-step-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", isActive ? "true" : "false");
    toggle.addEventListener("click", () => {
      state.activeDreamTraceStepId = state.activeDreamTraceStepId === step.stepId ? "" : step.stepId;
      renderActiveView();
    });

    toggle.append(el("span", "memory-trace-step-marker", String(index + 1)));
    const summary = el("div", "memory-trace-step-summary");
    const head = el("div", "memory-trace-step-head");
    head.append(el("strong", "", traceStepLabel(step)));
    head.append(el("span", "memory-trace-kind-badge", step.kind));
    summary.append(head);
    summary.append(el("div", "memory-trace-step-line", decodeEscapedTraceText(renderTraceSummary(step.inputSummary, step.inputSummaryI18n))));
    summary.append(el("div", "memory-trace-step-line is-output", decodeEscapedTraceText(renderTraceSummary(step.outputSummary, step.outputSummaryI18n))));
    toggle.append(summary);
    toggle.append(el("span", "memory-trace-step-chevron", isActive ? "▴" : "▾"));
    item.append(toggle);

    if (isActive) {
      const expanded = el("div", "memory-trace-step-expanded");
      const meta = el("div", "memory-trace-expanded-meta");
      meta.append(
        createTraceMetaChip(t("board.memoryTrace.status"), formatTraceRawValue(step.status)),
        createTraceMetaChip(t("board.memoryTrace.kind"), formatTraceRawValue(step.kind)),
      );
      expanded.append(meta);
      renderTraceStepExpandedContent(expanded, step);
      item.append(expanded);
    }

    list.append(item);
  });
  flow.append(list);
  page.append(flow);
  host.append(page);
}

function renderMemoryTrace(host) {
  clearNode(host);
  const page = el("div", "memory-trace-page");
  const controls = el("section", "memory-trace-hero");
  const header = el("div", "memory-trace-section-head");
  header.append(el("h4", "", t("board.memoryTrace")));
  renderTraceModeControls(header);
  controls.append(header);
  if (state.traceMode === "index") {
    renderIndexTriggerFilters(controls);
  } else if (state.traceMode === "dream") {
    renderDreamTriggerFilters(controls);
  }
  page.append(controls);
  host.append(page);

  const content = el("div");
  host.append(content);
  if (state.traceMode === "index") renderIndexTrace(content);
  else if (state.traceMode === "dream") renderDreamTrace(content);
  else renderRecallTrace(content);
}

/* ── chrome rendering ──────────────────────────────────── */

function renderBrowserHeader() {
  const level = getCurrentLevel();
  const searchKey = getCurrentSearchKey();
  const selectedProject = getSelectedProjectGroup();
  const selectedRecord = state.selectedFileId ? state.recordCache.get(state.selectedFileId) || null : null;
  if (browserTitle) {
    if (state.mainView === "project-detail") browserTitle.textContent = selectedProject?.projectName || t("level.project.label");
    else if (state.mainView === "file-detail") {
      browserTitle.textContent = selectedRecord?.name || selectedRecord?.file || t("detail.title");
    }
    else browserTitle.textContent = t(`level.${level}.label`);
  }
  if (listQueryInput) listQueryInput.value = searchKey ? state.queries[searchKey] || "" : "";
  if (listClearBtn) listClearBtn.style.display = searchKey && normalizeText(state.queries[searchKey]) ? "" : "none";
  if (listSearchRow) {
    const hidden = state.mainView === "user" || state.mainView === "file-detail";
    listSearchRow.style.display = hidden ? "none" : "";
  }
  if (browserMeta) {
    if (state.mainView === "project-detail" && selectedProject) {
      browserMeta.textContent = t(
        "stream.items",
        formatNumber(Number(selectedProject.projectCount || 0) + Number(selectedProject.feedbackCount || 0)),
      );
    } else if (state.mainView === "tmp") {
      browserMeta.textContent = t("stream.items", formatNumber(state.tmpSnapshot?.totalFiles || 0));
    } else if (state.mainView === "file-detail") {
      browserMeta.textContent = state.selectedFileType ? t(`type.${state.selectedFileType}`) : t("common.none");
    } else {
      browserMeta.textContent = t("stream.items", formatNumber(getMemoryCount(level)));
    }
  }
}

function renderNav() {
  if (boardNavTabs) {
    boardNavTabs.querySelectorAll("[data-page]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-page") === getNavPage());
    });
    boardNavTabs.querySelectorAll("[data-count-for]").forEach((node) => {
      const level = node.getAttribute("data-count-for");
      node.textContent = isValidLevel(level) ? String(getMemoryCount(level)) : "0";
    });
  }
}

function renderActiveView() {
  renderNav();
  renderBrowserHeader();
  ["project-list", "project-detail", "file-detail", "tmp", "user", "memory_trace"].forEach((view) => {
    const node = getViewElement(view);
    if (node) node.classList.toggle("board-active", view === state.mainView);
  });
  if (state.mainView === "project-list") renderProjectListView();
  else if (state.mainView === "project-detail") renderProjectDetailView(getSelectedProjectGroup());
  else if (state.mainView === "file-detail") renderFileDetailView(state.selectedFileId ? state.recordCache.get(state.selectedFileId) || null : null);
  else if (state.mainView === "tmp") renderTmpBoard();
  else if (state.mainView === "user") renderUserBoard();
  else renderMemoryTrace(memoryTraceBoard);
}

/* ── actions ───────────────────────────────────────────── */

async function saveSettings() {
  const autoIndexIntervalMinutes = Math.max(0, Number(autoIndexIntervalHoursInput?.value || 0) * 60);
  const autoDreamIntervalMinutes = Math.max(0, Number(autoDreamIntervalHoursInput?.value || 0) * 60);

  const saved = await postJson("./api/settings", {
    autoIndexIntervalMinutes,
    autoDreamIntervalMinutes,
  });
  state.settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  syncSettingsForm();
  setActivity("status.settingsSaved");
}

function syncSettingsForm() {
  if (autoIndexIntervalHoursInput) autoIndexIntervalHoursInput.value = String((state.settings.autoIndexIntervalMinutes || 0) / 60);
  if (autoDreamIntervalHoursInput) autoDreamIntervalHoursInput.value = String((state.settings.autoDreamIntervalMinutes || 0) / 60);
}

async function runIndexNow() {
  const ok = await confirmAction({
    title: t("confirm.sync.title"),
    body: t("confirm.sync.body"),
    confirmLabel: t("confirm.sync.ok"),
  });
  if (!ok) return;
  setActivity("status.building");
  const stats = await postJson("./api/index/run");
  invalidateMemoryCaches();
  invalidateTraceCaches();
  await loadSnapshot({ silent: true });
  await ensureActiveData({ force: true });
  await renderCurrentMainView({ force: true });
  setActivity(
    "status.built",
    formatNumber(stats.capturedSessions || 0),
    formatNumber(stats.writtenFiles || 0),
    formatNumber(stats.writtenProjectFiles || 0),
    formatNumber(stats.writtenFeedbackFiles || 0),
    formatNumber(stats.userProfilesUpdated || 0),
  );
  renderActiveView();
}

async function runDreamNow() {
  const ok = await confirmAction({
    title: t("confirm.dream.title"),
    body: t("confirm.dream.body"),
    confirmLabel: t("confirm.dream.ok"),
  });
  if (!ok) return;
  setActivity("status.dreaming");
  try {
    const result = await postJson("./api/dream/run");
    invalidateMemoryCaches();
    invalidateTraceCaches();
    await loadSnapshot({ silent: true });
    await ensureActiveData({ force: true });
    await renderCurrentMainView({ force: true });
    setActivity("status.dreamed", result.summary || t("common.none"));
    renderActiveView();
  } catch (error) {
    setActivity("status.dreamFailed", error instanceof Error ? error.message : String(error));
  }
}

async function exportMemory() {
  setActivity("status.exporting");
  try {
    const response = await fetch("./api/export");
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    const filename = extractDownloadFilename(response, "clawxmemory-memory.json");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setActivity("status.exported", filename);
  } catch (error) {
    setActivity("status.exportFailed", error instanceof Error ? error.message : String(error));
  }
}

async function importMemory(file) {
  const ok = await confirmAction({
    title: t("confirm.import.title"),
    body: t("confirm.import.body"),
    confirmLabel: t("confirm.import.ok"),
  });
  if (!ok) return;
  setActivity("status.importing");
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    const result = await postJson("./api/import", parsed);
    invalidateMemoryCaches();
    invalidateTraceCaches();
    await loadSnapshot({ silent: true });
    await ensureActiveData({ force: true });
    await renderCurrentMainView({ force: true });
    setActivity(
      "status.imported",
      formatNumber(result?.imported?.managedFiles || 0),
      formatNumber(result?.imported?.memoryFiles || 0),
      formatNumber(result?.imported?.project || 0),
      formatNumber(result?.imported?.feedback || 0),
      formatNumber(result?.imported?.user || 0),
    );
    renderActiveView();
  } catch (error) {
    if (error instanceof SyntaxError) {
      setActivity("status.importInvalid");
      return;
    }
    setActivity("status.importFailed", error instanceof Error ? error.message : String(error));
  }
}

async function clearMemory() {
  const ok = await confirmAction({
    title: t("confirm.clear.title"),
    body: t("confirm.clear.body"),
    confirmLabel: t("confirm.clear.ok"),
  });
  if (!ok) return;
  setActivity("status.clearing");
  await postJson("./api/clear");
  invalidateMemoryCaches();
  invalidateTraceCaches();
  state.mainView = "project-list";
  state.selectedProjectId = "";
  state.selectedFileId = "";
  state.selectedFileType = "";
  state.fileReturnView = "project-list";
  await loadSnapshot({ silent: true });
  await ensureActiveData({ force: true });
  renderActiveView();
  setActivity("status.cleared");
}

/* ── interaction ───────────────────────────────────────── */

async function switchPage(page) {
  if (!isValidLevel(page)) return;
  state.mainView = page === "project" ? "project-list" : page;
  if (page === "project") {
    state.selectedProjectId = "";
    state.selectedFileId = "";
    state.selectedFileType = "";
    state.fileReturnView = "project-list";
  }
  await ensureActiveData();
  renderActiveView();
}

async function runSearch() {
  const key = getCurrentSearchKey();
  if (!key) return;
  if (listQueryInput) state.queries[key] = normalizeText(listQueryInput.value);
  setActivity("status.searching");
  await ensureActiveData({ force: true });
  await renderCurrentMainView({ force: true });
  renderActiveView();
  setActivity("status.searched");
}

async function clearSearch() {
  const key = getCurrentSearchKey();
  if (!key) return;
  state.queries[key] = "";
  if (listQueryInput) listQueryInput.value = "";
  await ensureActiveData({ force: true });
  await renderCurrentMainView({ force: true });
  renderActiveView();
}

/* ── boot ──────────────────────────────────────────────── */

function wireEvents() {
  if (boardNavTabs) {
    boardNavTabs.addEventListener("click", (event) => {
      const btn = event.target instanceof Element ? event.target.closest("[data-page]") : null;
      const page = btn?.getAttribute("data-page");
      if (page) void switchPage(page);
    });
  }

  refreshBtn?.addEventListener("click", async () => {
    await loadSnapshot();
    await ensureActiveData({ force: true });
    await renderCurrentMainView({ force: true });
    renderActiveView();
  });
  buildNowBtn?.addEventListener("click", () => {
    void runIndexNow();
  });
  dreamRunBtn?.addEventListener("click", () => {
    void runDreamNow();
  });
  saveSettingsBtn?.addEventListener("click", () => {
    void saveSettings();
  });
  overviewToggleBtn?.addEventListener("click", () => openPanel("overview"));
  overviewCloseBtn?.addEventListener("click", closePanels);
  projectDetailBackBtn?.addEventListener("click", () => {
    state.mainView = "project-list";
    state.selectedProjectId = "";
    state.selectedFileId = "";
    state.selectedFileType = "";
    renderActiveView();
  });
  fileDetailBackBtn?.addEventListener("click", () => {
    if (state.fileReturnView === "tmp") {
      state.mainView = "tmp";
      state.selectedFileId = "";
      state.selectedFileType = "";
      renderActiveView();
      return;
    }
    if (state.fileReturnView === "user") {
      state.mainView = "user";
      state.selectedFileId = "";
      state.selectedFileType = "";
      renderActiveView();
      return;
    }
    if (!state.selectedProjectId || state.fileReturnView === "project-list") {
      state.mainView = "project-list";
      state.selectedFileId = "";
      state.selectedFileType = "";
      renderActiveView();
      return;
    }
    state.mainView = "project-detail";
    state.selectedFileId = "";
    state.selectedFileType = "";
    renderActiveView();
  });
  listSearchBtn?.addEventListener("click", () => {
    void runSearch();
  });
  listClearBtn?.addEventListener("click", () => {
    void clearSearch();
  });
  listQueryInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch();
    }
  });

  navToggleBtn?.addEventListener("click", openNav);
  navCloseBtn?.addEventListener("click", closeNav);
  appScrim?.addEventListener("click", () => {
    closePanels();
    closeNav();
    setSettingsPopover(false);
  });

  navMenuTrigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    setSettingsPopover(!state.settingsPopoverOpen);
  });
  window.addEventListener("resize", () => {
    if (state.settingsPopoverOpen) positionSettingsPopover();
  });
  window.addEventListener("scroll", () => {
    if (state.settingsPopoverOpen) positionSettingsPopover();
  }, true);

  document.addEventListener("click", (event) => {
    if (!state.settingsPopoverOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (settingsPopover?.contains(target) || navMenuTrigger?.contains(target)) return;
    setSettingsPopover(false);
  });

  advancedSettingsToggle?.addEventListener("click", () => {
    const open = !advancedSettingsBody?.classList.contains("open");
    toggleSection(advancedSettingsToggle, advancedSettingsBody, open);
  });
  dataManagementToggle?.addEventListener("click", () => {
    const open = !dataManagementBody?.classList.contains("open");
    toggleSection(dataManagementToggle, dataManagementBody, open);
  });

  themeToggle?.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-theme-value]") : null;
    const theme = btn?.getAttribute("data-theme-value");
    if (!theme) return;
    state.theme = theme;
    persistUiPrefs();
    applyTheme();
    applyTranslations();
    renderOverview();
    renderActiveView();
  });

  langToggle?.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-locale]") : null;
    const locale = btn?.getAttribute("data-locale");
    if (!locale || !LOCALES[locale]) return;
    state.locale = locale;
    persistUiPrefs();
    applyTheme();
    applyTranslations();
    renderOverview();
    void renderCurrentMainView().then(() => {
      renderActiveView();
    });
  });

  accentPicker?.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-accent]") : null;
    const accent = btn?.getAttribute("data-accent");
    if (!accent) return;
    state.accent = accent;
    persistUiPrefs();
    applyTheme();
  });

  exportMemoryBtn?.addEventListener("click", () => {
    void exportMemory();
  });
  importMemoryBtn?.addEventListener("click", () => importMemoryInput?.click());
  importMemoryInput?.addEventListener("change", (event) => {
    const input = event.target;
    const file = input instanceof HTMLInputElement ? input.files?.[0] : null;
    if (!file) return;
    void importMemory(file).finally(() => {
      if (input instanceof HTMLInputElement) input.value = "";
    });
  });
  clearMemoryBtn?.addEventListener("click", () => {
    void clearMemory();
  });

  modalConfirm?.addEventListener("click", () => {
    if (typeof state.modalSubmitHandler === "function") {
      state.modalSubmitHandler();
      return;
    }
    closeModal(true);
  });
  modalCancel?.addEventListener("click", () => closeModal(false));
  modalOverlay?.addEventListener("click", (event) => {
    if (event.target === modalOverlay) closeModal(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.modalResolver) {
      closeModal(false);
      return;
    }
    if (state.settingsPopoverOpen) {
      setSettingsPopover(false);
      return;
    }
    if (body.dataset.nav === "open") {
      closeNav();
      return;
    }
    if (body.dataset.panel) {
      closePanels();
    }
  });

  if (window.matchMedia) {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener?.("change", () => {
      if (state.theme === "auto") applyTheme();
    });
  }
}

async function bootstrap() {
  applyTheme();
  applyTranslations();
  toggleSection(advancedSettingsToggle, advancedSettingsBody, false);
  toggleSection(dataManagementToggle, dataManagementBody, false);
  wireEvents();
  renderFileDetailView(null);
  try {
    setActivity("status.loading");
    await loadSnapshot({ silent: true });
    await ensureActiveData({ force: true });
    await renderCurrentMainView();
    renderActiveView();
    setActivity("status.ready");
  } catch (error) {
    setActivity("status.loadFail", error instanceof Error ? error.message : String(error));
    renderActiveView();
  }
}

void bootstrap();
